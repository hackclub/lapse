import { implement } from "@orpc/server";
import { adminRouterContract, ADMIN_ENTITY_FIELDS, getAllOAuthScopes, type AdminEntity, type AdminFilter, type AdminFilterOperator, type AdminSort, type AdminUserRow, type AdminTimelapseRow, type AdminCommentRow, type AdminDraftTimelapseRow, type AdminLegacyTimelapseRow, type ProgramKeyMetadata } from "@hackclub/lapse-api";
import { match } from "@hackclub/lapse-shared";

import { type Context, logMiddleware, requiredAuth, requiredImplicitUser, requiredScopes } from "@/router.js";
import { apiErr, apiOk } from "@/common.js";
import { database } from "@/db.js";
import { env } from "@/env.js";
import { logInfo } from "@/logging.js";
import { generateProgramKey, extractProgramKeyPrefix, hashServiceSecret } from "@/oauth.js";

import * as db from "@/generated/prisma/client.js";

const os = implement(adminRouterContract)
    .$context<Context>()
    .use(logMiddleware);

type FieldKind = "string" | "number" | "date" | "enum" | "boolean";

type FieldDefs = Record<string, {
    label: string;
    kind: FieldKind;
    sortable?: boolean;
    editable?: boolean;
    enumValues?: readonly string[];
}>;

function getFieldDefs(entity: AdminEntity): FieldDefs {
    return ADMIN_ENTITY_FIELDS[entity] as FieldDefs;
}

function buildOperatorCondition(field: string, operator: AdminFilterOperator, value: unknown, containsValue: unknown = value): Record<string, unknown> {
    return match(operator, {
        "eq": { [field]: value },
        "neq": { [field]: { not: value } },
        "contains": { [field]: containsValue },
        "gt": { [field]: { gt: value } },
        "lt": { [field]: { lt: value } },
        "gte": { [field]: { gte: value } },
        "lte": { [field]: { lte: value } }
    });
}

function buildFilterCondition(field: string, operator: AdminFilterOperator, value: string, kind: FieldKind): Record<string, unknown> {
    return (
        kind === "date" ? buildOperatorCondition(field, operator, new Date(Number.parseInt(value, 10))) :
        kind === "number" ? buildOperatorCondition(field, operator, Number.parseFloat(value)) :
        kind === "boolean" ? buildOperatorCondition(field, operator, value === "true") :
        buildOperatorCondition(field, operator, value, { contains: value, mode: "insensitive" })
    );
}

const JOIN_FIELD_MAP: Record<string, { relation: string; field: string }> = {
    ownerHandle: { relation: "owner", field: "handle" },
    authorHandle: { relation: "author", field: "handle" }
};

function buildWhere(filters: AdminFilter[], fieldDefs: FieldDefs): Record<string, unknown> {
    if (filters.length === 0)
        return {};

    const conditions: Record<string, unknown>[] = [];

    for (const filter of filters) {
        const def = fieldDefs[filter.field];
        if (!def)
            continue;

        const joinInfo = JOIN_FIELD_MAP[filter.field];
        if (joinInfo) {
            const condition = buildFilterCondition(joinInfo.field, filter.operator, filter.value, def.kind);
            conditions.push({ [joinInfo.relation]: condition });
        }
        else {
            conditions.push(buildFilterCondition(filter.field, filter.operator, filter.value, def.kind));
        }
    }

    if (conditions.length === 0)
        return {};

    if (conditions.length === 1)
        return conditions[0];

    return { AND: conditions };
}

function buildOrderBy(sort: AdminSort | undefined, fieldDefs: FieldDefs): Record<string, unknown> | undefined {
    if (!sort)
        return undefined;

    const def = fieldDefs[sort.field];
    if (!def || !def.sortable)
        return undefined;

    if (sort.field === "sessionsCount" || sort.field === "snapshotsCount")
        return undefined;

    const joinInfo = JOIN_FIELD_MAP[sort.field];
    if (joinInfo)
        return { [joinInfo.relation]: { [joinInfo.field]: sort.direction } };

    return { [sort.field]: sort.direction };
}

function sortDraftTimelapseRows(rows: AdminDraftTimelapseRow[], sort: AdminSort | undefined): AdminDraftTimelapseRow[] {
    if (!sort)
        return rows;

    if (sort.field !== "sessionsCount" && sort.field !== "snapshotsCount")
        return rows;

    const sortField: "sessionsCount" | "snapshotsCount" = sort.field;
    const direction = sort.direction === "asc" ? 1 : -1;

    return [...rows].sort((left, right) => {
        const leftValue = left[sortField];
        const rightValue = right[sortField];

        if (leftValue !== rightValue)
            return (leftValue - rightValue) * direction;

        return right.createdAt - left.createdAt;
    });
}

function dtoAdminUser(entity: db.User): AdminUserRow {
    return {
        id: entity.id,
        email: entity.email,
        handle: entity.handle,
        displayName: entity.displayName,
        permissionLevel: entity.permissionLevel,
        profilePictureUrl: entity.profilePictureUrl,
        bio: entity.bio,
        hackatimeId: entity.hackatimeId,
        slackId: entity.slackId,
        createdAt: entity.createdAt.getTime(),
        lastHeartbeat: entity.lastHeartbeat.getTime()
    };
}

function dtoAdminTimelapse(entity: db.Timelapse & { owner: db.User }): AdminTimelapseRow {
    return {
        id: entity.id,
        name: entity.name,
        thumbnailUrl: entity.thumbnailS3Key == null ? null : `${env.S3_PUBLIC_URL_PUBLIC}/${entity.thumbnailS3Key}`,
        visibility: entity.visibility,
        duration: entity.duration,
        ownerId: entity.ownerId,
        ownerHandle: entity.owner.handle,
        hackatimeProject: entity.hackatimeProject,
        sourceDraftId: entity.sourceDraftId,
        createdAt: entity.createdAt.getTime(),
        associatedJobId: entity.associatedJobId
    };
}

function dtoAdminComment(entity: db.Comment & { author: db.User }): AdminCommentRow {
    return {
        id: entity.id,
        content: entity.content,
        authorId: entity.authorId,
        authorHandle: entity.author.handle,
        timelapseId: entity.timelapseId,
        createdAt: entity.createdAt.getTime()
    };
}

function dtoAdminDraftTimelapse(entity: db.DraftTimelapse & { owner: db.User }): AdminDraftTimelapseRow {
    return {
        id: entity.id,
        name: entity.name,
        description: entity.description,
        ownerId: entity.ownerId,
        ownerHandle: entity.owner.handle,
        deviceId: entity.deviceId,
        associatedTimelapseId: entity.associatedTimelapseId,
        createdAt: entity.createdAt.getTime(),
        sessionsCount: entity.sessions.length,
        snapshotsCount: entity.snapshots.length
    };
}

function dtoAdminLegacyTimelapse(entity: db.LegacyUnpublishedTimelapse & { owner: db.User }): AdminLegacyTimelapseRow {
    return {
        id: entity.id,
        name: entity.name,
        description: entity.description,
        primarySession: entity.primarySession,
        deviceId: entity.deviceId,
        ownerId: entity.ownerId,
        ownerHandle: entity.owner.handle,
        isMigrated: entity.isMigrated
    };
}

interface EntityConfig {
    list: (where: Record<string, unknown>, sort: AdminSort | undefined, orderBy: Record<string, unknown> | undefined, skip: number, take: number) => Promise<Record<string, unknown>[]>;
    count: (where: Record<string, unknown>) => Promise<number>;
    update: (id: string, changes: Record<string, unknown>, caller: db.User) => Promise<Record<string, unknown> | null>;
}

const EDITABLE_USER_FIELDS = new Set(["email", "handle", "displayName", "bio", "hackatimeId", "slackId", "permissionLevel"]);
const EDITABLE_TIMELAPSE_FIELDS = new Set(["name", "description", "visibility", "hackatimeProject"]);
const EDITABLE_COMMENT_FIELDS = new Set(["content"]);
const EDITABLE_DRAFT_FIELDS = new Set(["name", "description"]);

function sanitizeChanges(changes: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) {
        if (allowed.has(key)) {
            result[key] = changes[key];
        }
    }

    return result;
}

const entityConfigs: Record<AdminEntity, EntityConfig> = {
    user: {
        list: async (where, _sort, orderBy, skip, take) => {
            const rows = await database().user.findMany({ where, orderBy, skip, take });
            return rows.map(dtoAdminUser);
        },
        count: (where) => database().user.count({ where }),
        update: async (id, changes) => {
            const safe = sanitizeChanges(changes, EDITABLE_USER_FIELDS);
            if (Object.keys(safe).length === 0)
                return null;

            const updated = await database().user.update({
                where: { id },
                data: safe
            });

            return dtoAdminUser(updated);
        }
    },
    timelapse: {
        list: async (where, _sort, orderBy, skip, take) => {
            const rows = await database().timelapse.findMany({
                where, orderBy, skip, take,
                include: { owner: true }
            });

            return rows.map(dtoAdminTimelapse);
        },
        count: (where) => database().timelapse.count({ where }),
        update: async (id, changes) => {
            const safe = sanitizeChanges(changes, EDITABLE_TIMELAPSE_FIELDS);
            if (Object.keys(safe).length === 0)
                return null;

            const updated = await database().timelapse.update({
                where: { id },
                data: safe,
                include: { owner: true }
            });

            return dtoAdminTimelapse(updated);
        }
    },
    comment: {
        list: async (where, _sort, orderBy, skip, take) => {
            const rows = await database().comment.findMany({
                where, orderBy, skip, take,
                include: { author: true }
            });

            return rows.map(dtoAdminComment);
        },
        count: (where) => database().comment.count({ where }),
        update: async (id, changes) => {
            const safe = sanitizeChanges(changes, EDITABLE_COMMENT_FIELDS);
            if (Object.keys(safe).length === 0)
                return null;

            const updated = await database().comment.update({
                where: { id },
                data: safe,
                include: { author: true }
            });

            return dtoAdminComment(updated);
        }
    },
    draftTimelapse: {
        list: async (where, sort, orderBy, skip, take) => {
            if (sort?.field === "sessionsCount" || sort?.field === "snapshotsCount") {
                const rows = await database().draftTimelapse.findMany({
                    where,
                    include: { owner: true }
                });

                return sortDraftTimelapseRows(rows.map(dtoAdminDraftTimelapse), sort).slice(skip, skip + take);
            }

            const rows = await database().draftTimelapse.findMany({
                where, orderBy, skip, take,
                include: { owner: true }
            });

            return rows.map(dtoAdminDraftTimelapse);
        },
        count: (where) => database().draftTimelapse.count({ where }),
        update: async (id, changes) => {
            const safe = sanitizeChanges(changes, EDITABLE_DRAFT_FIELDS);
            if (Object.keys(safe).length === 0)
                return null;

            const updated = await database().draftTimelapse.update({
                where: { id },
                data: safe,
                include: { owner: true }
            });

            return dtoAdminDraftTimelapse(updated);
        }
    },
    legacyTimelapse: {
        list: async (where, _sort, orderBy, skip, take) => {
            const rows = await database().legacyUnpublishedTimelapse.findMany({
                where, orderBy, skip, take,
                include: { owner: true }
            });

            return rows.map(dtoAdminLegacyTimelapse);
        },
        count: (where) => database().legacyUnpublishedTimelapse.count({ where }),
        update: async () => null
    }
};

function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0)
        return n;

    if (n === 0)
        return m;

    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) {
        dp[i][0] = i;
    }

    for (let j = 0; j <= n; j++) {
        dp[0][j] = j;
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            }
            else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }

    return dp[m][n];
}

function fuzzyMatch(query: string, text: string): boolean {
    const normalizedQuery = query.toLowerCase();
    const normalizedText = text.toLowerCase();
    if (normalizedText.includes(normalizedQuery))
        return true;

    const distance = levenshteinDistance(normalizedQuery, normalizedText);
    return distance <= Math.ceil(normalizedQuery.length / 2);
}

function identifierMatch(query: string, value: string): boolean {
    return value.toLowerCase().includes(query.toLowerCase());
}

type SearchResultRow = { entity: AdminEntity; id: string; displayText: string };

type SearchDescriptor = SearchResultRow & {
    exactValues?: string[];
    fuzzyValues?: string[];
};


function pushSearchDescriptor(results: SearchResultRow[], query: string, descriptor: SearchDescriptor) {
    const { exactValues = [], fuzzyValues = [], ...result } = descriptor;
    const matches = [descriptor.id, ...exactValues].some(value => identifierMatch(query, value)) || fuzzyValues.some(value => fuzzyMatch(query, value));

    if (matches) {
        results.push(result);
    }
}

function dtoProgramKey(key: db.ProgramKey & { createdByUser: db.User }): ProgramKeyMetadata {
    return {
        id: key.id,
        name: key.name,
        keyPrefix: key.keyPrefix,
        scopes: key.scopes,
        createdBy: {
            id: key.createdByUser.id,
            handle: key.createdByUser.handle,
            displayName: key.createdByUser.displayName,
        },
        createdAt: key.createdAt.toISOString(),
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        revokedAt: key.revokedAt?.toISOString() ?? null,
        expiresAt: key.expiresAt.toISOString(),
    };
}

export default os.router({
    stats: os.stats
        .use(requiredAuth("ADMIN"))
        .use(requiredScopes("elevated"))
        .handler(async () => {
            const [userCount, durationAgg, projectCount] = await Promise.all([
                database().user.count(),
                database().timelapse.aggregate({ _sum: { duration: true } }),
                database().timelapse.groupBy({
                    by: ["hackatimeProject"],
                    where: { hackatimeProject: { not: null } }
                })
            ]);

            return apiOk({
                totalLoggedSeconds: durationAgg._sum.duration ?? 0,
                totalProjects: projectCount.length,
                totalUsers: userCount
            });
        }),

    list: os.list
        .use(requiredAuth("ADMIN"))
        .use(requiredScopes("elevated"))
        .handler(async (req) => {
            const { entity, filters, sort, page, pageSize } = req.input;
            const fieldDefs = getFieldDefs(entity);
            const config = entityConfigs[entity];

            const where = buildWhere(filters, fieldDefs);
            const orderBy = buildOrderBy(sort, fieldDefs);
            const skip = (page - 1) * pageSize;

            const [rows, total] = await Promise.all([
                config.list(where, sort, orderBy, skip, pageSize),
                config.count(where)
            ]);

            return {
                ok: true as const,
                data: { entity, rows, total, page, pageSize }
            };
        }),

    update: os.update
        .use(requiredAuth("ADMIN"))
        .use(requiredScopes("elevated"))
        .use(requiredImplicitUser())
        .handler(async (req) => {
            const caller = req.context.user;
            const { entity, id, changes } = req.input;

            if (entity === "user" && "permissionLevel" in changes) {
                if (caller.permissionLevel !== "ROOT") {
                    return apiErr("NO_PERMISSION", "Only ROOT users can change permission levels.");
                }
            }

            const config = entityConfigs[entity];
            const row = await config.update(id, changes as Record<string, unknown>, caller);

            if (!row)
                return apiErr("ERROR", "No valid changes provided.");

            logInfo(`Admin update: ${entity} ${id}`, {
                actor: caller.id,
                entity,
                id,
                changes
            });

            return {
                ok: true as const,
                data: { entity, row }
            };
        }),

    programKey: os.programKey.router({
        create: os.programKey.create
            .use(requiredAuth("ROOT"))
            .use(requiredScopes("elevated"))
            .use(requiredImplicitUser())
            .handler(async (req) => {
                const caller = req.context.user;
                const { name, scopes, expiresAt } = req.input;

                const validScopes = new Set(getAllOAuthScopes());
                for (const scope of scopes) {
                    if (!validScopes.has(scope as never)) {
                        return apiErr("ERROR", `Unknown scope: "${scope}"`);
                    }
                }

                const maxExpiry = Date.now() + 365 * 24 * 60 * 60 * 1000;
                if (expiresAt > maxExpiry)
                    return apiErr("ERROR", "Expiry must be within 1 year from now.");

                if (expiresAt <= Date.now())
                    return apiErr("ERROR", "Expiry must be in the future.");

                const rawKey = generateProgramKey();
                const keyHash = hashServiceSecret(rawKey);
                const keyPrefix = extractProgramKeyPrefix(rawKey);

                const key = await database().programKey.create({
                    include: { createdByUser: true },
                    data: {
                        name,
                        keyHash,
                        keyPrefix,
                        scopes,
                        createdByUserId: caller.id,
                        expiresAt: new Date(expiresAt),
                    }
                });

                await database().programKeyAudit.create({
                    data: { programKeyId: key.id, action: "created" }
                });

                logInfo(`Program key "${name}" created by @${caller.handle}.`);

                return apiOk({ key: dtoProgramKey(key), rawKey });
            }),

        list: os.programKey.list
            .use(requiredAuth("ROOT"))
            .use(requiredScopes("elevated"))
            .handler(async () => {
                const keys = await database().programKey.findMany({
                    include: { createdByUser: true },
                    orderBy: { createdAt: "desc" }
                });

                return apiOk({ keys: keys.map(dtoProgramKey) });
            }),

        rotate: os.programKey.rotate
            .use(requiredAuth("ROOT"))
            .use(requiredScopes("elevated"))
            .use(requiredImplicitUser())
            .handler(async (req) => {
                const caller = req.context.user;
                const { id } = req.input;

                const existing = await database().programKey.findUnique({ where: { id } });
                if (!existing)
                    return apiErr("NOT_FOUND", "Program key not found.");

                if (existing.expiresAt <= new Date())
                    return apiErr("ERROR", "Cannot rotate an expired key.");

                if (existing.revokedAt)
                    return apiErr("ERROR", "Cannot rotate a revoked key.");

                const rawKey = generateProgramKey();
                const keyHash = hashServiceSecret(rawKey);
                const keyPrefix = extractProgramKeyPrefix(rawKey);

                const key = await database().programKey.update({
                    where: { id },
                    include: { createdByUser: true },
                    data: { keyHash, keyPrefix }
                });

                await database().programKeyAudit.create({
                    data: { programKeyId: id, action: "rotated" }
                });

                logInfo(`Program key "${existing.name}" rotated by @${caller.handle}.`);

                return apiOk({ key: dtoProgramKey(key), rawKey });
            }),

        revoke: os.programKey.revoke
            .use(requiredAuth("ROOT"))
            .use(requiredScopes("elevated"))
            .use(requiredImplicitUser())
            .handler(async (req) => {
                const caller = req.context.user;
                const { id } = req.input;

                const existing = await database().programKey.findUnique({ where: { id } });
                if (!existing)
                    return apiErr("NOT_FOUND", "Program key not found.");

                if (existing.revokedAt)
                    return apiErr("ERROR", "Key is already revoked.");

                await database().programKey.update({
                    where: { id },
                    data: { revokedAt: new Date() }
                });

                await database().programKeyAudit.create({
                    data: { programKeyId: id, action: "revoked" }
                });

                logInfo(`Program key "${existing.name}" revoked by @${caller.handle}.`);

                return apiOk({});
            }),

        update: os.programKey.update
            .use(requiredAuth("ROOT"))
            .use(requiredScopes("elevated"))
            .use(requiredImplicitUser())
            .handler(async (req) => {
                const caller = req.context.user;
                const { id, name, scopes } = req.input;

                if (scopes) {
                    const validScopes = new Set(getAllOAuthScopes());
                    for (const scope of scopes) {
                        if (!validScopes.has(scope as never))
                            return apiErr("ERROR", `Unknown scope: "${scope}"`);
                    }
                }

                const existing = await database().programKey.findUnique({ where: { id } });
                if (!existing)
                    return apiErr("NOT_FOUND", "Program key not found.");

                const key = await database().programKey.update({
                    where: { id },
                    include: { createdByUser: true },
                    data: { name, scopes }
                });

                logInfo(`Program key "${existing.name}" updated by @${caller.handle}.`);

                return apiOk({ key: dtoProgramKey(key) });
            }),
    }),

    search: os.search
        .use(requiredAuth("ADMIN"))
        .use(requiredScopes("elevated"))
        .handler(async (req) => {
            const query = req.input.query.trim();
            if (!query) {
                return {
                    ok: true as const,
                    data: { results: [] }
                };
            }

            const results: SearchResultRow[] = [];

            const [users, timelapses, comments, drafts, legacyTimelapses] = await Promise.all([
                database().user.findMany({
                    select: { id: true, handle: true, displayName: true, slackId: true }
                }),

                database().timelapse.findMany({
                    select: { id: true, name: true, owner: { select: { handle: true } } }
                }),

                database().comment.findMany({
                    select: { id: true, content: true, author: { select: { handle: true } } }
                }),
                
                database().draftTimelapse.findMany({
                    select: { id: true, name: true, owner: { select: { handle: true } } }
                }),

                database().legacyUnpublishedTimelapse.findMany({
                    select: { id: true, name: true, owner: { select: { handle: true } } }
                })
            ]);

            for (const user of users) {
                pushSearchDescriptor(
                    results,
                    query,
                    {
                        entity: "user" as const,
                        id: user.id,
                        displayText: `${user.displayName} (@${user.handle})`,
                        exactValues: user.slackId === null ? [] : [user.slackId],
                        fuzzyValues: [user.handle, user.displayName]
                    }
                );
            }

            for (const timelapse of timelapses) {
                pushSearchDescriptor(
                    results,
                    query,
                    {
                        entity: "timelapse" as const,
                        id: timelapse.id,
                        displayText: `${timelapse.name} by @${timelapse.owner.handle}`,
                        fuzzyValues: [timelapse.name, timelapse.owner.handle]
                    }
                );
            }

            for (const comment of comments) {
                const preview = comment.content.substring(0, 50) + (comment.content.length > 50 ? "..." : "");
                pushSearchDescriptor(
                    results,
                    query,
                    {
                        entity: "comment" as const,
                        id: comment.id,
                        displayText: `"${preview}" by @${comment.author.handle}`,
                        fuzzyValues: [preview, comment.author.handle]
                    }
                );
            }

            for (const draft of drafts) {
                const displayName = draft.name || "(Untitled)";
                pushSearchDescriptor(
                    results,
                    query,
                    {
                        entity: "draftTimelapse" as const,
                        id: draft.id,
                        displayText: `${displayName} by @${draft.owner.handle}`,
                        fuzzyValues: [displayName, draft.owner.handle]
                    }
                );
            }

            for (const legacy of legacyTimelapses) {
                pushSearchDescriptor(
                    results,
                    query,
                    {
                        entity: "legacyTimelapse" as const,
                        id: legacy.id,
                        displayText: `${legacy.name} by @${legacy.owner.handle} (legacy)`,
                        fuzzyValues: [legacy.name, legacy.owner.handle]
                    }
                );
            }

            return {
                ok: true as const,
                data: { results: results.slice(0, 10) }
            };
        })
});
