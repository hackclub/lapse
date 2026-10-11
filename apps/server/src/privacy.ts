import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { FastifyInstance } from "fastify";

import { database } from "@/db.js";
import { env } from "@/env.js";
import type * as db from "@/generated/prisma/client.js";
import { logError, logInfo } from "@/logging.js";
import { firstUseOf, PrivacyTokenError, verifyPrivacyToken, type PrivacyAction, type PrivacySubject } from "@/privacyToken.js";

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

type Bucket = "encrypted" | "public";

const s3 = new S3Client({
    region: "auto",
    endpoint: env.S3_ENDPOINT,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

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
    const retained = await retainedRecords(userIds, owned);

    if (!dryRun)
        await deleteObjects(objects);

    const deleted = await deleteRows(userIds, owned, dryRun);
    const objectCount = objects.encrypted.length + objects.public.length;
    if (objectCount > 0)
        deleted["S3 objects"] = objectCount;

    return { found: true, deleted, retained };
}

async function matchingUsers(subject: PrivacySubject): Promise<{ id: string }[]> {
    const conditions: db.Prisma.UserWhereInput[] = subject.emails.map(email => ({ email: { equals: email, mode: "insensitive" } }));
    if (subject.slackId)
        conditions.push({ slackId: subject.slackId });

    // Lapse doesn't store Hack Club identity IDs, so `identityId` can't match anyone here.
    if (conditions.length === 0)
        return [];

    return await database().user.findMany({ where: { OR: conditions }, select: { id: true } });
}

type OwnedRecords = Awaited<ReturnType<typeof ownedRecords>>;

async function ownedRecords(userIds: string[]) {
    const [timelapses, drafts, legacyTimelapses, lookoutDrafts] = await Promise.all([
        database().timelapse.findMany({
            where: { ownerId: { in: userIds } },
            select: { id: true, s3Key: true, thumbnailS3Key: true, lookoutSessionId: true, hackatimeProject: true }
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
            select: { id: true }
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

    for (const timelapse of owned.timelapses) {
        for (const key of await listObjects("public", `timelapses/${timelapse.id}/`))
            published.add(key);
    }

    return { encrypted: [...encrypted].filter(Boolean), public: [...published].filter(Boolean) };
}

async function retainedRecords(userIds: string[], owned: OwnedRecords): Promise<RetainedItem[]> {
    const audited = auditedEntities(owned);
    const [serviceClients, auditEntries] = await Promise.all([
        database().serviceClient.count({ where: { createdByUserId: { in: userIds } } }),
        database().adminAuditLog.count({ where: { OR: [...audited, { actorId: { in: userIds } }] } })
    ]);

    const lookoutRecordings = owned.lookoutDrafts.length
        + owned.timelapses.filter(timelapse => timelapse.lookoutSessionId !== null).length;

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
            type: "Lookout recordings",
            count: lookoutRecordings,
            reason: "stored by Lookout, which has no delete API yet; Lapse's references to them are deleted"
        },
        {
            type: "Hackatime heartbeats",
            count: hackatimeImports,
            reason: "imported into the person's Hackatime account; the Hackatime target deletes them"
        }
    ];

    return retained.filter(item => item.count > 0);
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

async function deleteRows(userIds: string[], owned: OwnedRecords, dryRun: boolean): Promise<Record<string, number>> {
    try {
        return await database().$transaction(async tx => {
            const ownedBy = { ownerId: { in: userIds } };
            const counts: Record<string, number> = {
                Comment: (await tx.comment.deleteMany({ where: { id: { in: owned.comments.map(comment => comment.id) } } })).count,
                DraftTimelapse: (await tx.draftTimelapse.deleteMany({ where: ownedBy })).count,
                LegacyUnpublishedTimelapse: (await tx.legacyUnpublishedTimelapse.deleteMany({ where: ownedBy })).count,
                Timelapse: (await tx.timelapse.deleteMany({ where: ownedBy })).count,
                KnownDevice: (await tx.knownDevice.deleteMany({ where: ownedBy })).count,
                DraftLookoutTimelapse: (await tx.draftLookoutTimelapse.deleteMany({ where: ownedBy })).count,
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
        const page = await s3Call(() => s3.send(new ListObjectsV2Command({
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
            const response = await s3Call(() => s3.send(new DeleteObjectsCommand({
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

function bucketName(bucket: Bucket) {
    return bucket === "encrypted" ? env.S3_ENCRYPTED_BUCKET_NAME : env.S3_PUBLIC_BUCKET_NAME;
}
