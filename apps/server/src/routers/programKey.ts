import { implement } from "@orpc/server";
import { programKeyRouterContract, getAllProgramScopes, PROGRAM_SCOPE_GROUPS, type LapseProgramScope, type ProgramKeyMetadata } from "@hackclub/lapse-api";

import { type Context, logMiddleware, requiredAuth, requiredScopes } from "@/router.js";
import { apiErr, apiOk } from "@/common.js";
import { database } from "@/db.js";
import { generateProgramKey, extractProgramKeyPrefix, hashServiceSecret } from "@/oauth.js";

import type * as db from "@/generated/prisma/client.js";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const os = implement(programKeyRouterContract)
    .$context<Context>()
    .use(logMiddleware);

type DbProgramKey = db.ProgramKey & { createdByUser: db.User };

function dtoProgramKey(entity: DbProgramKey): ProgramKeyMetadata {
    return {
        id: entity.id,
        name: entity.name,
        keyPrefix: entity.keyPrefix,
        scopes: entity.scopes,
        createdBy: {
            id: entity.createdByUser.id,
            handle: entity.createdByUser.handle,
            displayName: entity.createdByUser.displayName
        },
        createdAt: entity.createdAt.toISOString(),
        lastUsedAt: entity.lastUsedAt?.toISOString() ?? null,
        revokedAt: entity.revokedAt?.toISOString() ?? null,
        expiresAt: entity.expiresAt.toISOString()
    };
}

export default os.router({
    create: os.create
        .use(requiredAuth("ROOT"))
        .use(requiredScopes("elevated"))
        .handler(async (req) => {
            const caller = req.context.user;

            // Validate scopes
            const validScopes = new Set<string>(getAllProgramScopes());
            const invalidScopes = req.input.scopes.filter(s => !validScopes.has(s));
            if (invalidScopes.length > 0)
                return apiErr("ERROR", `Unknown program scopes: ${invalidScopes.join(", ")}`);

            // Validate expiration
            const expiresAt = new Date(req.input.expiresAt);
            const now = new Date();
            if (expiresAt <= now)
                return apiErr("ERROR", "Expiration date must be in the future.");
            if (expiresAt.getTime() - now.getTime() > ONE_YEAR_MS)
                return apiErr("ERROR", "Expiration date must be within 1 year from now.");

            const rawKey = generateProgramKey();
            const keyPrefix = extractProgramKeyPrefix(rawKey);
            const keyHash = hashServiceSecret(rawKey);

            const programKey = await database().programKey.create({
                include: { createdByUser: true },
                data: {
                    name: req.input.name,
                    scopes: req.input.scopes,
                    keyHash,
                    keyPrefix,
                    expiresAt,
                    createdByUserId: caller.id
                }
            });

            // Audit log
            await database().programKeyAudit.create({
                data: {
                    programKeyId: programKey.id,
                    action: "created",
                    ip: req.context.req.ip,
                    userAgent: req.context.req.headers["user-agent"] ?? null
                }
            });

            return apiOk({ key: dtoProgramKey(programKey), rawKey });
        }),

    list: os.list
        .use(requiredAuth("ROOT"))
        .use(requiredScopes("elevated"))
        .handler(async () => {
            const keys = await database().programKey.findMany({
                include: { createdByUser: true },
                orderBy: { createdAt: "desc" }
            });

            return apiOk({ keys: keys.map(dtoProgramKey) });
        }),

    rotate: os.rotate
        .use(requiredAuth("ROOT"))
        .use(requiredScopes("elevated"))
        .handler(async (req) => {
            const existing = await database().programKey.findUnique({
                where: { id: req.input.id }
            });

            if (!existing || existing.revokedAt)
                return apiErr("NOT_FOUND", `Program key with ID ${req.input.id} not found.`);

            const rawKey = generateProgramKey();
            const keyPrefix = extractProgramKeyPrefix(rawKey);
            const keyHash = hashServiceSecret(rawKey);

            const updated = await database().programKey.update({
                where: { id: req.input.id },
                include: { createdByUser: true },
                data: { keyHash, keyPrefix }
            });

            // Audit log
            await database().programKeyAudit.create({
                data: {
                    programKeyId: updated.id,
                    action: "rotated",
                    ip: req.context.req.ip,
                    userAgent: req.context.req.headers["user-agent"] ?? null
                }
            });

            return apiOk({ key: dtoProgramKey(updated), rawKey });
        }),

    revoke: os.revoke
        .use(requiredAuth("ROOT"))
        .use(requiredScopes("elevated"))
        .handler(async (req) => {
            const existing = await database().programKey.findUnique({
                where: { id: req.input.id }
            });

            if (!existing || existing.revokedAt)
                return apiErr("NOT_FOUND", `Program key with ID ${req.input.id} not found.`);

            await database().programKey.update({
                where: { id: req.input.id },
                data: { revokedAt: new Date() }
            });

            // Audit log
            await database().programKeyAudit.create({
                data: {
                    programKeyId: req.input.id,
                    action: "revoked",
                    ip: req.context.req.ip,
                    userAgent: req.context.req.headers["user-agent"] ?? null
                }
            });

            return apiOk({});
        }),

    scopes: os.scopes
        .use(requiredAuth("ROOT"))
        .use(requiredScopes("elevated"))
        .handler(async () => {
            const scopes: Array<{ scope: string; description: string; group: string }> = [];

            for (const [group, groupScopes] of Object.entries(PROGRAM_SCOPE_GROUPS)) {
                for (const [scope, description] of Object.entries(groupScopes)) {
                    scopes.push({ scope, description, group });
                }
            }

            return apiOk({ scopes });
        }),

    updateScopes: os.updateScopes
        .use(requiredAuth("ROOT"))
        .use(requiredScopes("elevated"))
        .handler(async (req) => {
            const validScopes = new Set<string>(getAllProgramScopes());
            const invalidScopes = req.input.scopes.filter(s => !validScopes.has(s));
            if (invalidScopes.length > 0)
                return apiErr("ERROR", `Unknown program scopes: ${invalidScopes.join(", ")}`);

            const existing = await database().programKey.findUnique({
                where: { id: req.input.id }
            });

            if (!existing || existing.revokedAt)
                return apiErr("NOT_FOUND", `Program key with ID ${req.input.id} not found.`);

            const updated = await database().programKey.update({
                where: { id: req.input.id },
                include: { createdByUser: true },
                data: { scopes: req.input.scopes }
            });

            return apiOk({ key: dtoProgramKey(updated) });
        })
});
