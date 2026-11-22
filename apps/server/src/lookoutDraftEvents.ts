import type * as db from "@/generated/prisma/client.js";

import { database, type TransactionClient } from "@/db.js";
import { logInfo } from "@/logging.js";
import type * as safe from "@/secrets.js";

/**
 * Every state change of a `DraftLookoutTimelapse` goes through here, and each one writes a `LookoutDraftEvent` in
 * the same transaction. The draft is the only link Lapse has to a recording, and when one goes missing the question
 * is always "why" - which server logs can't answer once they've rotated away.
 *
 * Only publishing actually deletes a draft. Discarding archives it instead: a discard is one click (plus a confirm)
 * away on several screens, and a recording thrown away by accident used to be gone for good.
 */

export type LookoutDraftArchiveReason = "discarded" | "session-gone";

export const ARCHIVE_REASONS: readonly LookoutDraftArchiveReason[] = ["discarded", "session-gone"];

type DraftRef = Pick<safe.DraftLookoutTimelapse, "id" | "lookoutSessionId" | "ownerId">;

function describe(draft: DraftRef): string {
    return `Lookout draft ${draft.id} (session ${draft.lookoutSessionId}, owner ${draft.ownerId})`;
}

/**
 * Creates a draft. `mode` is the recording mode picked in the browser, kept so the recording mode picker can be
 * measured - `null` when the draft wasn't started from it.
 */
export async function createLookoutDraft(
    data: db.Prisma.DraftLookoutTimelapseUncheckedCreateInput,
    options: { actor: string | null; mode: string | null }
): Promise<safe.DraftLookoutTimelapse> {
    return await database().$transaction(async tx => {
        const draft = await tx.draftLookoutTimelapse.create({ data });

        await tx.lookoutDraftEvent.create({
            data: {
                draftId: draft.id,
                lookoutSessionId: draft.lookoutSessionId,
                ownerId: draft.ownerId,
                kind: "created",
                actor: options.actor,
                detail: options.mode ? { mode: options.mode } : undefined,
            },
        });

        return draft;
    });
}

/**
 * Hides a draft from the user's live drafts, keeping it restorable. Returns `false` if it was already archived or
 * no longer exists.
 */
export async function archiveLookoutDraft(
    draft: DraftRef,
    reason: LookoutDraftArchiveReason,
    options?: { actor?: string; detail?: db.Prisma.InputJsonValue }
): Promise<boolean> {
    const archived = await database().$transaction(async tx => {
        const { count } = await tx.draftLookoutTimelapse.updateMany({
            where: { id: draft.id, archivedAt: null },
            data: { archivedAt: new Date(), archivedReason: reason },
        });

        if (count === 0)
            return false;

        await tx.lookoutDraftEvent.create({
            data: {
                draftId: draft.id,
                lookoutSessionId: draft.lookoutSessionId,
                ownerId: draft.ownerId,
                kind: "archived",
                reason,
                actor: options?.actor ?? null,
                detail: options?.detail,
            },
        });

        return true;
    });

    if (archived)
        logInfo(`Archived ${describe(draft)}: ${reason}${options?.actor ? ` by ${options.actor}` : ""}.`);

    return archived;
}

/**
 * Brings an archived draft back. Returns `false` if it wasn't archived.
 *
 * Takes a transaction client so callers that restore as a side effect of something else (storing a publish intent)
 * can do both atomically.
 */
export async function restoreLookoutDraft(
    draft: DraftRef,
    options?: { actor?: string; tx?: TransactionClient }
): Promise<boolean> {
    const run = async (tx: TransactionClient) => {
        const { count } = await tx.draftLookoutTimelapse.updateMany({
            where: { id: draft.id, archivedAt: { not: null } },
            data: { archivedAt: null, archivedReason: null },
        });

        if (count === 0)
            return false;

        await tx.lookoutDraftEvent.create({
            data: {
                draftId: draft.id,
                lookoutSessionId: draft.lookoutSessionId,
                ownerId: draft.ownerId,
                kind: "restored",
                actor: options?.actor ?? null,
            },
        });

        return true;
    };

    const restored = options?.tx
        ? await run(options.tx)
        : await database().$transaction(run);

    if (restored)
        logInfo(`Restored ${describe(draft)}${options?.actor ? ` for ${options.actor}` : ""}.`);

    return restored;
}

/**
 * Deletes a draft that has become a timelapse. The event is only written if this call removed the row, so racing
 * finalizers leave one record between them rather than one each.
 */
export async function removePublishedLookoutDraft(draft: DraftRef, timelapseId: string): Promise<boolean> {
    const removed = await database().$transaction(async tx => {
        const { count } = await tx.draftLookoutTimelapse.deleteMany({ where: { id: draft.id } });
        if (count === 0)
            return false;

        await tx.lookoutDraftEvent.create({
            data: {
                draftId: draft.id,
                lookoutSessionId: draft.lookoutSessionId,
                ownerId: draft.ownerId,
                kind: "published",
                timelapseId,
            },
        });

        return true;
    });

    if (removed)
        logInfo(`Removed ${describe(draft)}: published as ${timelapseId}.`);

    return removed;
}

/**
 * Drops a draft's pending publish intent because the recording may not be published, so the sweeper stops retrying
 * it. The draft itself stays where it is; the user's answers are kept in the event's `detail`.
 */
export async function rejectLookoutPublish(
    draft: safe.DraftLookoutTimelapse,
    reason: string,
    options?: { detail?: db.Prisma.InputJsonValue }
): Promise<void> {
    await database().$transaction(async tx => {
        await tx.draftLookoutTimelapse.updateMany({
            where: { id: draft.id },
            data: {
                pendingName: null,
                pendingDescription: null,
                pendingVisibility: null,
                pendingHackatimeProject: null,
                pendingAt: null,
            },
        });

        await tx.lookoutDraftEvent.create({
            data: {
                draftId: draft.id,
                lookoutSessionId: draft.lookoutSessionId,
                ownerId: draft.ownerId,
                kind: "publish-rejected",
                reason,
                detail: {
                    name: draft.pendingName,
                    description: draft.pendingDescription,
                    visibility: draft.pendingVisibility,
                    hackatimeProject: draft.pendingHackatimeProject,
                    ...(options?.detail && typeof options.detail === "object" && !Array.isArray(options.detail) ? options.detail : {}),
                },
            },
        });
    });

    logInfo(`Rejected the publish of ${describe(draft)}: ${reason}.`);
}
