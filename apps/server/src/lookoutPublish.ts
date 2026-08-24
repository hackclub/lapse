import { randomBytes } from "node:crypto";

import * as db from "@/generated/prisma/client.js";

import { database, redis } from "@/db.js";
import { env } from "@/env.js";
import { lapseId } from "@/common.js";
import { logError, logInfo, logWarning } from "@/logging.js";
import * as lookout from "@/lookout.js";
import { durationBySnapshots, syncTimelapseWithHackatime, TIMELAPSE_INCLUDES, type DbOwnedTimelapse } from "@/routers/timelapse.js";

/**
 * Publishing a Lookout recording, split in two.
 *
 * Lookout's desktop app opens our publish panel the moment a recording is *saved*, which is minutes
 * before the video finishes compiling - the point being that nobody should have to watch a progress
 * bar before naming their timelapse. So the two halves of publishing come apart:
 *
 *   1. the user's answers (name, description, visibility, Hackatime project) are stored on the draft
 *      as a pending intent, which needs no video;
 *   2. the `Timelapse` itself is created once Lookout has a video to attach, which needs no user.
 *
 * Whoever notices the session is ready does step 2: the publish page's poll, the login-time draft
 * sweep, or the interval sweeper below for when nobody is looking at all.
 */

export type PublishIntent = {
    name: string;
    description: string;
    visibility: db.TimelapseVisibility;
    hackatimeProject: string | null;
};

export type FinalizeOutcome =
    /** The `Timelapse` now exists. */
    | { kind: "published"; timelapse: DbOwnedTimelapse }
    /** Lookout is still working; try again later. */
    | { kind: "waiting"; status: string }
    /** Lookout gave up on the recording, so there will never be a video. */
    | { kind: "failed"; status: string };

export function intentOf(draft: db.DraftLookoutTimelapse): PublishIntent | null {
    if (!draft.pendingAt || !draft.pendingName || !draft.pendingVisibility)
        return null;

    return {
        name: draft.pendingName,
        description: draft.pendingDescription ?? "",
        visibility: draft.pendingVisibility,
        hackatimeProject: draft.pendingHackatimeProject,
    };
}

export function timelapseUrl(timelapseId: string): string {
    return `${env.WEB_BASE_URL}/timelapse/${timelapseId}`;
}

/**
 * Records what the user asked for without publishing anything yet.
 *
 * Also tells Lookout the panel got its answers, so the desktop app stops offering it. That happens
 * here rather than after the video lands, because from the user's point of view they are done - and
 * a card nagging them for details they already gave would be a lie.
 */
export async function storePublishIntent(draft: db.DraftLookoutTimelapse, intent: PublishIntent): Promise<db.DraftLookoutTimelapse> {
    const updated = await database().draftLookoutTimelapse.update({
        where: { id: draft.id },
        data: {
            pendingName: intent.name,
            pendingDescription: intent.description,
            pendingVisibility: intent.visibility,
            pendingHackatimeProject: intent.hackatimeProject,
            pendingAt: new Date(),
        },
    });

    try {
        await lookout.markPanelResolved(draft.lookoutSessionId);
    }
    catch (err) {
        // Cosmetic only: the worst case is the desktop app offering a panel that reopens, sees the
        // intent already stored, and closes itself again.
        logWarning("Couldn't mark the Lookout panel resolved.", { err, draftId: draft.id });
    }

    return updated;
}

/**
 * Creates the `Timelapse` for a draft whose intent is already stored, if Lookout has a video.
 *
 * Idempotent by way of `Timelapse.lookoutSessionId` being unique - two sweepers racing on the same
 * draft means one of them loses the insert, not two timelapses.
 */
export async function finalizeLookoutDraft(draft: db.DraftLookoutTimelapse): Promise<FinalizeOutcome> {
    const intent = intentOf(draft);
    if (!intent)
        throw new Error(`Draft ${draft.id} has no pending publish intent to finalize.`);

    const existing = await database().timelapse.findFirst({
        where: { lookoutSessionId: draft.lookoutSessionId },
        include: TIMELAPSE_INCLUDES,
    });

    if (existing) {
        await database().draftLookoutTimelapse.deleteMany({ where: { id: draft.id } });
        return { kind: "published", timelapse: existing };
    }

    const session = await lookout.getSession(draft.lookoutSessionId);
    const status = session.session.status;

    if (status === "failed")
        return { kind: "failed", status };

    if (status !== "complete")
        return { kind: "waiting", status };

    const timings = await lookout.getTimings(draft.lookoutToken);
    const snapshots = timings.timestamps.map(ts => new Date(ts));

    const timelapse = await database().timelapse.create({
        data: {
            id: lapseId(),
            createdAt: draft.createdAt,
            ownerId: draft.ownerId,
            name: intent.name,
            description: intent.description,
            visibility: intent.visibility,
            lookoutSessionId: draft.lookoutSessionId,
            lookoutToken: draft.lookoutToken,
            lookoutVideoUrl: session.session.videoUrl,
            lookoutThumbnailUrl: session.session.thumbnailUrl,
            snapshots,
            duration: durationBySnapshots(snapshots),
            hackatimeProject: intent.hackatimeProject,
        },
        include: TIMELAPSE_INCLUDES,
    });

    await database().draftLookoutTimelapse.deleteMany({ where: { id: draft.id } });

    // Now that the timelapse has a page, point the desktop app's "Open in Lapse" action at it.
    try {
        await lookout.setViewUrl(draft.lookoutSessionId, timelapseUrl(timelapse.id));
    }
    catch (err) {
        logWarning("Couldn't set the Lookout view URL.", { err, timelapseId: timelapse.id });
    }

    if (intent.hackatimeProject && timelapse.owner.hackatimeId && timelapse.owner.hackatimeAccessToken) {
        try {
            await syncTimelapseWithHackatime(timelapse, timelapse.owner);
        }
        catch (err) {
            logError("Couldn't sync heartbeats during Lookout publish!", { err, timelapseId: timelapse.id });
        }
    }

    logInfo(`Published Lookout draft ${draft.id} as timelapse ${timelapse.id}.`);
    return { kind: "published", timelapse };
}

/**
 * Finalizes a draft if it is waiting on one, swallowing anything that goes wrong.
 *
 * For call sites that are really doing something else - polling status, listing drafts - and just
 * want to take the opportunity. They must not fail because a finalize did.
 */
export async function finalizeIfPending(draft: db.DraftLookoutTimelapse): Promise<FinalizeOutcome | null> {
    if (!intentOf(draft))
        return null;

    try {
        return await finalizeLookoutDraft(draft);
    }
    catch (err) {
        logError("Couldn't finalize a pending Lookout publish.", { err, draftId: draft.id });
        return null;
    }
}

const SWEEP_LOCK_KEY = "lapse:lookout_publish_sweep";
const SWEEP_INTERVAL_MS = 60_000;
/** Long enough to cover a slow sweep, short enough that a crashed one doesn't stall the next. */
const SWEEP_LOCK_TTL_MS = 5 * 60_000;

/**
 * Publishes every draft whose answers are in but whose video has since landed.
 *
 * This is the path for a user who filled in the panel and then closed the app: without it their
 * timelapse would sit unpublished (and its Hackatime heartbeats unsent) until they next opened
 * Lapse. Lookout has no webhook to tell us, so we look.
 */
export async function sweepPendingLookoutPublishes(): Promise<void> {
    // One replica per sweep. The insert is idempotent regardless, but there is no reason for every
    // instance to hammer Lookout with the same status requests.
    //
    // The token matters: a sweep that outlives the TTL would otherwise delete whichever replica's
    // lock came next on its way out, admitting a third. Release is a compare-and-delete on our own
    // token instead.
    const token = randomBytes(16).toString("hex");
    const held = await redis().set(SWEEP_LOCK_KEY, token, "PX", SWEEP_LOCK_TTL_MS, "NX");
    if (held !== "OK")
        return;

    try {
        const pending = await database().draftLookoutTimelapse.findMany({
            where: { pendingAt: { not: null } },
            orderBy: { pendingAt: "asc" },
            take: 100,
        });

        for (const draft of pending) {
            const outcome = await finalizeIfPending(draft);

            // A failed compile leaves the draft alone: the recording is gone, but the user's
            // answers are the only record of what they wanted, and the publish page can still
            // show them the failure.
            if (outcome?.kind === "failed")
                logWarning(`Lookout session for draft ${draft.id} failed; leaving the draft for the user.`, { draftId: draft.id });
        }
    }
    finally {
        await releaseSweepLock(token);
    }
}

const RELEASE_SWEEP_LOCK = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    end
    return 0
`;

async function releaseSweepLock(token: string): Promise<void> {
    try {
        await redis().eval(RELEASE_SWEEP_LOCK, 1, SWEEP_LOCK_KEY, token);
    }
    catch (err) {
        // Not releasing is safe - the TTL clears it - so never let this mask the sweep's own result.
        logWarning("Couldn't release the Lookout publish sweep lock.", { err });
    }
}

export function startLookoutPublishSweeper(): NodeJS.Timeout {
    const timer = setInterval(() => {
        void sweepPendingLookoutPublishes().catch(err => logError("Lookout publish sweep failed.", { err }));
    }, SWEEP_INTERVAL_MS);

    timer.unref();
    return timer;
}
