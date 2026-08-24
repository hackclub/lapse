import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import * as db from "@/generated/prisma/client.js";

import { database } from "@/db.js";
import { env } from "@/env.js";
import { lapseId } from "@/common.js";
import { logInfo, logWarning } from "@/logging.js";
import * as lookout from "@/lookout.js";
import { finalizeIfPending, intentOf, storePublishIntent, timelapseUrl } from "@/lookoutPublish.js";
import { hackatimeProjectsForUser } from "@/routers/hackatime.js";

/**
 * The endpoints Lookout's desktop app talks to directly.
 *
 * These are plain Fastify routes rather than oRPC procedures because none of their callers are a
 * signed-in Lapse client. The desktop app authenticates with a device token it got from pairing;
 * the publish panel authenticates with the unguessable URL Lookout handed it. Neither has our
 * cookies - a panel is a third-party iframe, and the desktop app is not a browser at all.
 *
 * Registered in `app.ts`. The paths here are the ones configured on Lapse's entry in Lookout's
 * program registry (`pairUrl`, `startUrl`), so renaming one is a coordinated change.
 */

/** Device tokens are bearer credentials, so only their hash is ever stored. */
function hashDeviceToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function base64url(buf: Buffer): string {
    return buf.toString("base64url");
}

/** Lookout's PKCE challenge is `base64url(sha256(verifier))`. */
function challengeFor(verifier: string): string {
    return base64url(createHash("sha256").update(verifier).digest());
}

function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const PAIRING_CODE_TTL_MS = 5 * 60_000;
const MAX_DEVICE_LABEL_LENGTH = 120;

export function generateDeviceToken(): string {
    return `lkd_${randomBytes(32).toString("hex")}`;
}

export function generatePanelToken(): string {
    return randomBytes(32).toString("hex");
}

/**
 * Mints a single-use pairing code for a user who has approved a device.
 *
 * Called from the consent page (which runs as the signed-in user), not by the desktop app - the app
 * only ever sees the code, and can only redeem it by proving it holds the verifier behind
 * `challenge`.
 */
export async function createPairingCode(userId: string, challenge: string, label: string): Promise<string> {
    const code = base64url(randomBytes(24));

    await database().lookoutPairingCode.create({
        data: {
            code,
            challenge,
            label: label.slice(0, MAX_DEVICE_LABEL_LENGTH),
            expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
            ownerId: userId,
        },
    });

    return code;
}

/** Resolves a `Authorization: Bearer` device token to its (non-revoked) device row. */
async function deviceFromRequest(req: FastifyRequest): Promise<(db.LookoutDevice & { owner: db.User }) | null> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer "))
        return null;

    const token = header.substring("Bearer ".length).trim();
    if (!token)
        return null;

    return await database().lookoutDevice.findFirst({
        where: { tokenHash: hashDeviceToken(token) },
        include: { owner: true },
    });
}

function str(value: unknown, max: number): string | null {
    if (typeof value !== "string")
        return null;

    const trimmed = value.trim();
    if (!trimmed || trimmed.length > max)
        return null;

    return trimmed;
}

export function registerLookoutDesktopRoutes(server: FastifyInstance) {
    /**
     * The consent page, opened in the user's real browser by the desktop app.
     *
     * Lives on the API rather than the web app because Lookout is configured with one `pairUrl` and
     * it has to serve the token exchange below too; this hop just carries the app's parameters over
     * to the page that can actually ask the user.
     */
    server.get("/lookout/pair", async (req: FastifyRequest, reply: FastifyReply) => {
        const query = req.query as Record<string, string | undefined>;
        const target = new URL("/lookout/pair", env.WEB_BASE_URL);

        for (const key of ["challenge", "state", "device"]) {
            const value = query[key];
            if (value)
                target.searchParams.set(key, value);
        }

        return reply.redirect(target.toString(), 302);
    });

    /**
     * Token exchange: the desktop app redeems its one-time code for a device token.
     *
     * No user session involved, by design - this is a machine-to-machine call from the app, and the
     * code plus verifier is the entire proof.
     */
    server.post("/lookout/pair", async (req: FastifyRequest, reply: FastifyReply) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const code = str(body["code"], 512);
        const verifier = str(body["verifier"], 512);

        if (!code || !verifier)
            return reply.code(400).send({ error: "code and verifier are required" });

        const pairing = await database().lookoutPairingCode.findUnique({ where: { code } });

        // Burn it whatever happens next: a code that has been presented once is spent, so a wrong
        // verifier doesn't get to try again.
        if (pairing)
            await database().lookoutPairingCode.deleteMany({ where: { code } });

        if (!pairing || pairing.expiresAt.getTime() < Date.now())
            return reply.code(400).send({ error: "invalid or expired code" });

        if (!safeEqual(challengeFor(verifier), pairing.challenge))
            return reply.code(400).send({ error: "verifier does not match challenge" });

        const deviceToken = generateDeviceToken();

        const device = await database().lookoutDevice.create({
            data: {
                label: pairing.label,
                tokenHash: hashDeviceToken(deviceToken),
                ownerId: pairing.ownerId,
            },
        });

        logInfo(`Paired Lookout device ${device.id} for user ${pairing.ownerId}.`);
        return reply.send({ deviceToken });
    });

    /** Revoke this device. Called by the desktop app's Settings → Linked Programs → Unlink. */
    server.delete("/lookout/pair", async (req: FastifyRequest, reply: FastifyReply) => {
        const device = await deviceFromRequest(req);

        // Idempotent: an already-revoked device unlinking again is a success, not a 404. The app
        // drops its copy either way, and disagreeing about it helps nobody.
        if (device) {
            await database().lookoutDevice.deleteMany({ where: { id: device.id } });
            logInfo(`Revoked Lookout device ${device.id}.`);
        }

        return reply.code(204).send();
    });

    /**
     * Start a recording for a paired device - the whole point of pairing.
     *
     * Same work as `createRecordingSession`, minus the browser: mint the draft id first (Lookout's
     * `redirectUrl` and `panelUrl` are immutable, so they have to be known before the session
     * exists), create the session, then store the draft.
     */
    server.post("/lookout/start", async (req: FastifyRequest, reply: FastifyReply) => {
        const device = await deviceFromRequest(req);
        if (!device)
            return reply.code(401).send({ error: "unknown or revoked device" });

        const draftId = lapseId();
        const panelToken = generatePanelToken();

        const session = await lookout.createSession(undefined, {
            lapseUserId: device.owner.id,
            lapseUserHandle: device.owner.handle,
            source: "lapse",
            lookoutDeviceId: device.id,
        }, {
            clips: true,
            redirectUrl: `${env.WEB_BASE_URL}/timelapse/handoff/${draftId}`,
            panelUrl: `${env.WEB_BASE_URL}/lookout/panel/${panelToken}`,
        });

        await database().draftLookoutTimelapse.create({
            data: {
                id: draftId,
                lookoutSessionId: session.sessionId,
                lookoutToken: session.token,
                panelToken,
                ownerId: device.owner.id,
            },
        });

        await database().lookoutDevice.update({
            where: { id: device.id },
            data: { lastUsedAt: new Date() },
        });

        logInfo(`Started Lookout session ${session.sessionId} from device ${device.id}.`);
        return reply.send({ sessionToken: session.token });
    });

    /**
     * Everything the publish panel needs to render, authenticated by its own URL.
     *
     * Note what this deliberately does NOT require: a compiled video. The panel opens as soon as the
     * recording is saved, so `lookoutStatus` here is usually `compiling`.
     */
    server.get("/lookout/panel/:panelToken", async (req: FastifyRequest, reply: FastifyReply) => {
        const { panelToken } = req.params as { panelToken: string };

        const draft = await database().draftLookoutTimelapse.findFirst({
            where: { panelToken },
            include: { owner: true },
        });

        if (!draft) {
            // Either a bad token, or the draft is already published - both look the same from here,
            // and the panel treats "gone" as "nothing left to do".
            return reply.code(404).send({ error: "no draft for that panel" });
        }

        const intent = intentOf(draft);

        // The desktop app asks for a title when the user stops recording and writes it to the
        // Lookout session, so by the time the panel opens we usually already know what they want
        // this called. Offering it back beats making them type it twice.
        let suggestedName: string | null = null;

        try {
            const session = await lookout.getSession(draft.lookoutSessionId);
            const name = session.session.name?.trim();

            if (name && !lookout.isPlaceholderSessionName(name))
                suggestedName = name.slice(0, 60);
        }
        catch (err) {
            // A prefill is a nicety; the panel still works without one.
            logWarning("Couldn't read the Lookout session name for a panel.", { err, draftId: draft.id });
        }

        return reply.send({
            draftId: draft.id,
            createdAt: draft.createdAt.toISOString(),
            handle: draft.owner.handle,
            hackatimeLinked: Boolean(draft.owner.hackatimeId && draft.owner.hackatimeAccessToken),
            suggestedName,
            // Non-null when the user has already answered: the panel then has nothing to ask and
            // reports itself done rather than showing the form a second time.
            submitted: intent,
        });
    });

    /**
     * Take the panel's answers.
     *
     * Stores them and, if Lookout happens to already be finished, publishes on the spot. Otherwise
     * the sweeper picks it up - either way the user is done here.
     */
    server.post("/lookout/panel/:panelToken", async (req: FastifyRequest, reply: FastifyReply) => {
        const { panelToken } = req.params as { panelToken: string };
        const body = (req.body ?? {}) as Record<string, unknown>;

        const draft = await database().draftLookoutTimelapse.findFirst({ where: { panelToken } });
        if (!draft)
            return reply.code(404).send({ error: "no draft for that panel" });

        // Answered once, and that's it. The intent stays live for minutes while the video compiles,
        // and without this the panel URL could be replayed to rewrite it - flipping an UNLISTED
        // choice to PUBLIC, say. The panel checks `submitted` on load and closes itself, so a
        // legitimate reopen never gets here.
        if (intentOf(draft))
            return reply.code(409).send({ error: "this timelapse has already been submitted" });

        const name = str(body["name"], 60);
        const visibility = body["visibility"];
        const description = typeof body["description"] === "string" ? body["description"].trim() : "";
        const hackatimeProject = str(body["hackatimeProject"], 128);

        if (!name || name.length < 2)
            return reply.code(400).send({ error: "name must be between 2 and 60 characters" });

        if (description.length > 280)
            return reply.code(400).send({ error: "description must be 280 characters or fewer" });

        if (visibility !== "PUBLIC" && visibility !== "UNLISTED")
            return reply.code(400).send({ error: "visibility must be PUBLIC or UNLISTED" });

        const stored = await storePublishIntent(draft, {
            name,
            description,
            visibility,
            hackatimeProject,
        });

        const outcome = await finalizeIfPending(stored);

        if (outcome?.kind === "published") {
            return reply.send({
                published: true,
                timelapseId: outcome.timelapse.id,
                url: timelapseUrl(outcome.timelapse.id),
            });
        }

        // Accepted but not yet published: the video is still compiling. The panel closes anyway -
        // there is nothing further to ask the user, and telling them to wait would be pointless.
        return reply.send({ published: false, timelapseId: null, url: null });
    });

    /** Hackatime projects for the panel's picker, scoped to the draft's owner. */
    server.get("/lookout/panel/:panelToken/hackatime-projects", async (req: FastifyRequest, reply: FastifyReply) => {
        const { panelToken } = req.params as { panelToken: string };

        const draft = await database().draftLookoutTimelapse.findFirst({
            where: { panelToken },
            include: { owner: true },
        });

        if (!draft)
            return reply.code(404).send({ error: "no draft for that panel" });

        if (!draft.owner.hackatimeId || !draft.owner.hackatimeAccessToken)
            return reply.send({ projects: [] });

        try {
            return reply.send({ projects: await hackatimeProjectsForUser(draft.owner) });
        }
        catch (err) {
            // The picker is optional - a timelapse publishes fine without a project, so a Hackatime
            // outage must not take the whole panel down with it.
            logWarning("Couldn't list Hackatime projects for a panel.", { err, draftId: draft.id });
            return reply.send({ projects: [] });
        }
    });
}
