import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { FastifyInstance } from "fastify";

import { deleteAirtableRowsForEmails } from "@/airtableSync.js";
import { notifyTimelapseChanged } from "@/changeWebhook.js";
import { database, type TransactionClient } from "@/db.js";
import type * as db from "@/generated/prisma/client.js";
import { cancelRealizeJob } from "@/job.js";
import { logError, logInfo } from "@/logging.js";
import * as lookout from "@/lookout.js";
import { firstUseOf, PrivacyTokenError, verifyPrivacyToken, type PrivacyAction, type PrivacySubject } from "@/privacyToken.js";
import { bucketName, s3For, type Bucket } from "@/storage.js";

const PRIVACY_ROUTES: Record<PrivacyAction, string> = {
    delete: "/api/privacy/delete",
    export: "/api/privacy/export"
};

export type RetainedItem = { type: string; count: number; reason: string };

export type ErasureResult = {
    found: boolean;
    deleted: Record<string, number>;
    retained: RetainedItem[];
};

type PrivacyReply = { statusCode: number; body: Record<string, unknown> };

// The hub gives up after 15 seconds, so per-timelapse and per-session calls run side by side rather than one by one.
const EXTERNAL_CONCURRENCY = 16;

/**
 * Errors that end a privacy call with a specific status. `code` is short snake_case and is safe to return and log.
 */
class PrivacyError extends Error {
    constructor(public readonly statusCode: number, public readonly code: string) {
        super(`Privacy request failed: ${code}`);
    }
}

class DryRunRollback extends Error {
    constructor(public readonly deleted: Record<string, number>) {
        super("Dry run rolled back.");
    }
}

/**
 * Registers the endpoints the Hack Club privacy hub calls. See `docs/privacy.md`.
 */
export function registerPrivacyRoutes(server: FastifyInstance) {
    for (const action of ["delete", "export"] as const) {
        server.post(PRIVACY_ROUTES[action], async (request, reply) => {
            const { statusCode, body } = await handlePrivacyRequest(action, request.headers.authorization);
            return reply.code(statusCode).send(body);
        });
    }
}

async function handlePrivacyRequest(action: PrivacyAction, authorization: string | undefined): Promise<PrivacyReply> {
    try {
        const claims = await verifyPrivacyToken(authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined);
        if (claims.action !== action)
            return { statusCode: 400, body: { error: "action_mismatch" } };

        if (!await firstUseOf(claims.jti))
            return { statusCode: 409, body: { error: "replayed" } };

        // Export delivery isn't specified yet, so an export reports what is held without changing anything.
        const dryRun = action === "export" || claims.dryRun;
        const result = await eraseSubject(claims.subject, dryRun);

        logInfo(`Privacy ${action} for request ${claims.requestId} finished (dry run: ${claims.dryRun}, found: ${result.found}).`);
        return {
            statusCode: 200,
            body: { request_id: claims.requestId, found: result.found, dry_run: claims.dryRun, deleted: result.deleted, retained: result.retained }
        };
    }
    catch (error) {
        if (error instanceof PrivacyTokenError)
            return { statusCode: error.code === "jwks_unavailable" ? 503 : 401, body: { error: error.code } };

        if (error instanceof PrivacyError)
            return { statusCode: error.statusCode, body: { error: error.code } };

        logError(`Privacy ${action} failed with ${error instanceof Error ? error.name : "an unknown error"}.`);
        return { statusCode: 500, body: { error: "internal_error" } };
    }
}

/**
 * Deletes everything Lapse holds about the users matching `subject`, or, on a dry run, performs the same deletion inside
 * a transaction that is rolled back, so the reviewed counts are the executed counts.
 */
export async function eraseSubject(subject: PrivacySubject, dryRun: boolean): Promise<ErasureResult> {
    const users = await matchingUsers(subject);
    if (users.length === 0)
        return { found: false, deleted: {}, retained: [] };

    const userIds = users.map(user => user.id);

    // Program keys and client reviews belong to staff accounts and back integrations other people rely on, so a human
    // decides what happens to them before the account can go.
    const staffRecords = await database().programKey.count({ where: { createdByUserId: { in: userIds } } })
        + await database().serviceClientReview.count({ where: { reviewedByUserId: { in: userIds } } });

    if (staffRecords > 0)
        throw new PrivacyError(409, "manual_review_required");

    const owned = await ownedRecords(userIds);
    const objects = await storedObjects(owned);
    const lookoutSessions = lookoutSessionIds(owned);
    const retained = await retainedRecords(userIds, owned);

    // Before anything irreversible, so an Airtable outage leaves everything untouched for the retry. If a later step
    // fails instead, the account survives and the next daily sync simply puts its row back.
    const emails = [...subject.emails, ...users.map(user => user.email)];
    let airtableRows: number;
    try {
        airtableRows = await deleteAirtableRowsForEmails(emails, dryRun);
    }
    catch {
        throw new PrivacyError(503, "airtable_unavailable");
    }

    // Lookout deletions go first among the irreversible ones because they can be undone. If anything after them fails, the
    // user keeps their account, so they must keep their videos too.
    const scheduled = dryRun ? [] : await deleteLookoutSessions(lookoutSessions);

    let deleted: Record<string, number>;
    try {
        if (!dryRun) {
            await deleteObjects(objects);

            for (const timelapse of owned.timelapses) {
                if (timelapse.associatedJobId)
                    await cancelRealizeJob(timelapse.associatedJobId);
            }
        }

        deleted = await deleteRows(userIds, owned, dryRun);
    }
    catch (error) {
        await restoreLookoutSessions(scheduled);
        throw error;
    }

    const objectCount = objects.encrypted.length + objects.public.length;
    if (objectCount > 0)
        deleted["S3 objects"] = objectCount;

    if (lookoutSessions.length > 0)
        deleted["Lookout sessions"] = lookoutSessions.length;

    if (airtableRows > 0)
        deleted["Airtable rows"] = airtableRows;

    return { found: true, deleted, retained };
}

async function matchingUsers(subject: PrivacySubject): Promise<{ id: string; email: string }[]> {
    const conditions: db.Prisma.UserWhereInput[] = subject.emails.map(email => ({ email: { equals: email, mode: "insensitive" } }));
    if (subject.slackId)
        conditions.push({ slackId: subject.slackId });

    // Lapse doesn't store Hack Club identity IDs, so `identityId` can't match anyone here.
    if (conditions.length === 0)
        return [];

    return await database().user.findMany({ where: { OR: conditions }, select: { id: true, email: true } });
}

type OwnedRecords = Awaited<ReturnType<typeof ownedRecords>>;

async function ownedRecords(userIds: string[]) {
    const [timelapses, drafts, legacyTimelapses, lookoutDrafts] = await Promise.all([
        database().timelapse.findMany({
            where: { ownerId: { in: userIds } },
            select: { id: true, s3Key: true, thumbnailS3Key: true, lookoutSessionId: true, hackatimeProject: true, associatedJobId: true }
        }),
        database().draftTimelapse.findMany({
            where: { ownerId: { in: userIds } },
            select: { id: true, sessions: true, thumbnailKey: true }
        }),
        database().legacyUnpublishedTimelapse.findMany({
            where: { ownerId: { in: userIds } },
            select: { id: true, primarySession: true, thumbnailS3Key: true }
        }),
        database().draftLookoutTimelapse.findMany({
            where: { ownerId: { in: userIds } },
            select: { id: true, lookoutSessionId: true }
        })
    ]);

    // Other people's comments on these timelapses go too, as a comment can't outlive its timelapse.
    const comments = await database().comment.findMany({
        where: { OR: [{ authorId: { in: userIds } }, { timelapseId: { in: timelapses.map(timelapse => timelapse.id) } }] },
        select: { id: true }
    });

    return { userIds, timelapses, drafts, legacyTimelapses, lookoutDrafts, comments };
}

async function storedObjects(owned: OwnedRecords): Promise<Record<Bucket, string[]>> {
    const encrypted = new Set<string>([
        ...owned.drafts.flatMap(draft => [...draft.sessions, draft.thumbnailKey]),
        ...owned.legacyTimelapses.flatMap(legacy => [legacy.primarySession, legacy.thumbnailS3Key])
    ]);

    const published = new Set<string>(
        owned.timelapses.flatMap(timelapse => [timelapse.s3Key, timelapse.thumbnailS3Key]).filter(key => key !== null)
    );

    // Uploads that never became a draft, and upload metadata, are only found by listing.
    for (const userId of owned.userIds) {
        for (const key of await listObjects("encrypted", `timelapses/${userId}/`))
            encrypted.add(key);
    }

    await forEachConcurrently(owned.timelapses, async timelapse => {
        for (const key of await listObjects("public", `timelapses/${timelapse.id}/`))
            published.add(key);
    });

    return { encrypted: [...encrypted].filter(Boolean), public: [...published].filter(Boolean) };
}

async function retainedRecords(userIds: string[], owned: OwnedRecords): Promise<RetainedItem[]> {
    const audited = auditedEntities(owned);
    const [serviceClients, auditEntries] = await Promise.all([
        database().serviceClient.count({ where: { createdByUserId: { in: userIds } } }),
        database().adminAuditLog.count({ where: { OR: [...audited, { actorId: { in: userIds } }] } })
    ]);

    const hackatimeImports = owned.timelapses.filter(timelapse => timelapse.hackatimeProject !== null).length;

    const retained: RetainedItem[] = [
        {
            type: "OAuth apps",
            count: serviceClients,
            reason: "kept so people who signed in with them keep working; the creator is removed"
        },
        {
            type: "admin audit entries",
            count: auditEntries,
            reason: "kept as the record of admin actions; the account and any recorded values are removed"
        },
        {
            type: "Hackatime heartbeats",
            count: hackatimeImports,
            reason: "imported into the person's Hackatime account; the Hackatime target deletes them"
        }
    ];

    return retained.filter(item => item.count > 0);
}

/**
 * Lookout has no accounts, so the sessions behind a user's Lookout drafts and timelapses can only be found through us.
 */
function lookoutSessionIds(owned: OwnedRecords): string[] {
    return [...new Set([
        ...owned.lookoutDrafts.map(draft => draft.lookoutSessionId),
        ...owned.timelapses.map(timelapse => timelapse.lookoutSessionId).filter(id => id !== null)
    ])];
}

/**
 * Has Lookout delete each session, returning the ones it scheduled. Lookout hides them at once and destroys them an
 * hour later, which leaves staff a window to restore them from Lookout's side if this erasure turns out to be a mistake.
 *
 * All or nothing: if any session can't be deleted, the ones already scheduled are restored before this throws. A
 * session we aren't allowed to delete fails every retry the same way, so without this each attempt would destroy the
 * rest of the user's videos while leaving their account - and the timelapses pointing at those videos - in place.
 */
async function deleteLookoutSessions(sessionIds: string[]): Promise<string[]> {
    const scheduled: string[] = [];
    const failures: PrivacyError[] = [];

    await forEachConcurrently(sessionIds, async sessionId => {
        if (failures.length > 0)
            return;

        try {
            await lookout.deleteSession(sessionId);
            scheduled.push(sessionId);
        }
        catch (error) {
            if (!lookout.isSessionGone(error)) {
                failures.push(new PrivacyError(503, "lookout_unavailable"));
                return;
            }

            // A 404 is either a session that is already gone, or one our key isn't allowed to delete - such as one
            // created before Lapse had its own program key, or a Lookout that predates deletion. Only the first is safe
            // to count as done.
            try {
                if (!await lookoutSessionGone(sessionId))
                    failures.push(new PrivacyError(409, "manual_review_required"));
            }
            catch (goneError) {
                failures.push(goneError instanceof PrivacyError ? goneError : new PrivacyError(503, "lookout_unavailable"));
            }
        }
    });

    if (failures.length > 0) {
        await restoreLookoutSessions(scheduled);
        throw failures[0];
    }

    return scheduled;
}

/**
 * Undoes `deleteLookoutSessions` for an erasure that didn't go through. Failures are logged rather than thrown, as the
 * caller is already failing with the error that matters; staff have until the grace period ends to restore by hand.
 */
async function restoreLookoutSessions(sessionIds: string[]) {
    await forEachConcurrently(sessionIds, async sessionId => {
        try {
            await lookout.restoreSession(sessionId);
        }
        catch {
            logError(`Privacy erasure failed, and Lookout session ${sessionId} could not be restored. Restore it by hand within the hour.`);
        }
    });
}

async function lookoutSessionGone(sessionId: string): Promise<boolean> {
    try {
        await lookout.getSession(sessionId);
        return false;
    }
    catch (error) {
        if (lookout.isSessionGone(error))
            return true;

        throw new PrivacyError(503, "lookout_unavailable");
    }
}

function auditedEntities(owned: OwnedRecords): db.Prisma.AdminAuditLogWhereInput[] {
    const entities: [string, string[]][] = [
        ["user", owned.userIds],
        ["timelapse", owned.timelapses.map(timelapse => timelapse.id)],
        ["comment", owned.comments.map(comment => comment.id)],
        ["draftTimelapse", owned.drafts.map(draft => draft.id)],
        ["lookoutDraft", owned.lookoutDrafts.map(draft => draft.id)],
        ["legacyTimelapse", owned.legacyTimelapses.map(legacy => legacy.id)]
    ];

    return entities
        .filter(([, ids]) => ids.length > 0)
        .map(([entity, ids]) => ({ entity, entityId: { in: ids } }));
}

/**
 * Deletes timelapses, recording each one in `TimelapseDeletion` so that services following `timelapse.listChanged`
 * delete their copies too. Their IDs are added to `deleted`.
 */
async function deleteTimelapses(tx: TransactionClient, where: db.Prisma.TimelapseWhereInput, deleted: string[]): Promise<number> {
    const rows = await tx.timelapse.findMany({ where, select: { id: true, ownerId: true } });
    if (rows.length === 0)
        return 0;

    const deletedAt = new Date();
    await tx.timelapseDeletion.createMany({
        data: rows.map(x => ({ timelapseId: x.id, ownerId: x.ownerId, deletedAt })),
        skipDuplicates: true
    });

    deleted.push(...rows.map(x => x.id));
    return (await tx.timelapse.deleteMany({ where: { id: { in: rows.map(x => x.id) } } })).count;
}

async function deleteRows(userIds: string[], owned: OwnedRecords, dryRun: boolean): Promise<Record<string, number>> {
    const deletedTimelapses: string[] = [];

    try {
        const result = await database().$transaction(async tx => {
            const ownedBy = { ownerId: { in: userIds } };
            const counts: Record<string, number> = {
                Comment: (await tx.comment.deleteMany({ where: { id: { in: owned.comments.map(comment => comment.id) } } })).count,
                DraftTimelapse: (await tx.draftTimelapse.deleteMany({ where: ownedBy })).count,
                LegacyUnpublishedTimelapse: (await tx.legacyUnpublishedTimelapse.deleteMany({ where: ownedBy })).count,
                Timelapse: await deleteTimelapses(tx, ownedBy, deletedTimelapses),
                KnownDevice: (await tx.knownDevice.deleteMany({ where: ownedBy })).count,
                DraftLookoutTimelapse: (await tx.draftLookoutTimelapse.deleteMany({ where: ownedBy })).count,
                LookoutDraftEvent: (await tx.lookoutDraftEvent.deleteMany({ where: ownedBy })).count,
                LookoutDevice: (await tx.lookoutDevice.deleteMany({ where: ownedBy })).count,
                LookoutPairingCode: (await tx.lookoutPairingCode.deleteMany({ where: ownedBy })).count,
                ServiceTokenAudit: (await tx.serviceTokenAudit.deleteMany({ where: { userId: { in: userIds } } })).count,
                ServiceGrant: (await tx.serviceGrant.deleteMany({ where: { userId: { in: userIds } } })).count
            };

            const audited = auditedEntities(owned);
            if (audited.length > 0)
                await tx.adminAuditLog.updateMany({ where: { OR: audited }, data: { changes: {} } });

            counts["User"] = (await tx.user.deleteMany({ where: { id: { in: userIds } } })).count;

            const deleted = Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
            if (dryRun)
                throw new DryRunRollback(deleted);

            return deleted;
        }, { timeout: 60_000 });

        for (const id of deletedTimelapses)
            notifyTimelapseChanged("timelapse.deleted", id);

        return result;
    }
    catch (error) {
        if (error instanceof DryRunRollback)
            return error.deleted;

        throw error;
    }
}

async function listObjects(bucket: Bucket, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
        const page = await s3Call(() => s3For(bucket).send(new ListObjectsV2Command({
            Bucket: bucketName(bucket),
            Prefix: prefix,
            ContinuationToken: continuationToken
        })));

        for (const object of page.Contents ?? []) {
            if (object.Key)
                keys.push(object.Key);
        }

        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
}

async function deleteObjects(objects: Record<Bucket, string[]>) {
    for (const bucket of ["encrypted", "public"] as const) {
        const keys = objects[bucket];
        for (let start = 0; start < keys.length; start += 1000) {
            const batch = keys.slice(start, start + 1000);
            const response = await s3Call(() => s3For(bucket).send(new DeleteObjectsCommand({
                Bucket: bucketName(bucket),
                Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true }
            })));

            if (response.Errors && response.Errors.length > 0)
                throw new PrivacyError(503, "storage_unavailable");
        }
    }
}

async function s3Call<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    }
    catch {
        throw new PrivacyError(503, "storage_unavailable");
    }
}

async function forEachConcurrently<T>(items: T[], action: (item: T) => Promise<void>) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(EXTERNAL_CONCURRENCY, queue.length) }, async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift())
            await action(item);
    });

    await Promise.all(workers);
}
