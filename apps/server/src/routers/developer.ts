import { implement } from "@orpc/server"
import { developerRouterContract, getAllOAuthScopes, type LapseOAuthScope, type OAuthApp, type OAuthGrant } from "@hackclub/lapse-api"

import { type Context, logMiddleware, requiredAuth } from "@/router.js";
import { apiErr, apiOk } from "@/common.js";
import { database } from "@/db.js";
import { createServiceClient, normalizeRedirectUris, normalizeScopes, rotateServiceClientSecret } from "@/oauth.js";

import * as db from "@/generated/prisma/client.js";

const os = implement(developerRouterContract)
    .$context<Context>()
    .use(logMiddleware);

/**
 * Represents a `db.ServiceClient` with related tables included.
 */
export type DbOAuthApp = db.ServiceClient & { createdByUser: db.User };

/**
 * Represents a `db.ServiceGrant` with related tables included.
 */
export type DbOAuthGrant = db.ServiceGrant & { serviceClient: db.ServiceClient };

export function dtoOAuthApp(entity: DbOAuthApp): OAuthApp {
    return {
        id: entity.id,
        name: entity.name,
        description: entity.description,
        homepageUrl: entity.homepageUrl,
        iconUrl: entity.iconUrl,
        redirectUris: entity.redirectUris,
        scopes: entity.scopes,
        trustLevel: entity.trustLevel,
        clientId: entity.clientId,
        createdBy: {
            id: entity.createdByUser.id,
            handle: entity.createdByUser.handle,
            displayName: entity.createdByUser.displayName
        },
        createdAt: entity.createdAt.toISOString()
    };
}

export function dtoOAuthGrant(entity: DbOAuthGrant): OAuthGrant {
    return {
        id: entity.id,
        serviceClientId: entity.serviceClientId,
        serviceName: entity.serviceClient.name,
        scopes: entity.scopes,
        createdAt: entity.createdAt.toISOString(),
        lastUsedAt: entity.lastUsedAt?.toISOString() ?? null
    };
}

export default os.router({
    rotateAppSecret: os.rotateAppSecret
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const app = await database.serviceClient.findFirst({
                where: {
                    id: req.input.id,
                    createdByUserId: caller.id,
                    revokedAt: null
                }
            });

            if (!app)
                return apiErr("NOT_FOUND", `App with ID ${req.input.id} not found.`);

            const { clientSecret } = await rotateServiceClientSecret(app.id);
            return apiOk({ clientSecret });
        }),

    updateApp: os.updateApp
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const app = await database.serviceClient.findFirst({
                where: { id: req.input.id, createdByUserId: caller.id, revokedAt: null }
            });
        
            if (!app)
                return apiErr("NOT_FOUND", `App with ID ${req.input.id} not found.`);
        
            let normalizedScopes: LapseOAuthScope[] | undefined = undefined;

            if (req.input.scopes) {
                const validScopes = new Set<string>(getAllOAuthScopes());
                const requestedScopes = normalizeScopes(req.input.scopes);
                const invalidScopes = requestedScopes.filter(scope => !validScopes.has(scope));

                if (invalidScopes.length > 0)
                    return apiErr("ERROR", `Unknown scopes: ${invalidScopes.join(", ")}`)

                normalizedScopes = requestedScopes as LapseOAuthScope[];
            }

            if (req.input.homepageUrl || req.input.redirectUris) {
                const homepageUrl = req.input.homepageUrl ?? app.homepageUrl;
                const redirectUris = req.input.redirectUris ?? app.redirectUris;
                const homepageHost = new URL(homepageUrl).hostname;
                const mismatched = redirectUris.filter(uri => new URL(uri).hostname !== homepageHost);

                if (mismatched.length > 0) {
                    return apiErr("ERROR", "Redirect URIs must match the homepage domain.");
                }
            }
    
            const updated = await database.serviceClient.update({
                where: { id: app.id },
                include: { createdByUser: true },
                data: {
                    name: req.input.name,
                    description: req.input.description,
                    homepageUrl: req.input.homepageUrl,
                    iconUrl: req.input.iconUrl,
                    redirectUris: req.input.redirectUris && normalizeRedirectUris(req.input.redirectUris),
                    scopes: normalizedScopes
                }
            });
    
            return apiOk({ app: dtoOAuthApp(updated) });
        }),

    revokeApp: os.revokeApp
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;
            
            const app = await database.serviceClient.findFirst({
                where: { id: req.input.id, createdByUserId: caller.id, revokedAt: null }
            });
        
            if (!app)
                return apiErr("NOT_FOUND", `App with ID ${req.input.id} not found.`);

            await database.serviceClient.update({
                where: { id: req.input.id },
                data: { revokedAt: new Date() }
            });
        
            return apiOk({});
        }),

    getAllOwnedApps: os.getAllOwnedApps
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const apps = await database.serviceClient.findMany({
                where: { createdByUserId: caller.id, revokedAt: null },
                orderBy: { createdAt: "desc" },
                include: { createdByUser: true },
            });

            return apiOk({ apps: apps.map(dtoOAuthApp) });
        }),

    createApp: os.createApp
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const validScopes = new Set<string>(getAllOAuthScopes());
            const requestedScopes = normalizeScopes(req.input.scopes);
            const invalidScopes = requestedScopes.filter(scope => !validScopes.has(scope));
            if (invalidScopes.length > 0)
                return apiErr("ERROR", `Unknown scopes: ${invalidScopes.join(", ")}`);

            const redirectUris = normalizeRedirectUris(req.input.redirectUris);
            const homepageHost = new URL(req.input.homepageUrl).hostname;
            const mismatchedRedirects = redirectUris.filter(uri => new URL(uri).hostname !== homepageHost);
            if (mismatchedRedirects.length > 0)
                return apiErr("ERROR", "Redirect URIs must match the homepage domain.");

            const { client, clientSecret } = await createServiceClient({
                name: req.input.name,
                description: req.input.description ?? "",
                homepageUrl: req.input.homepageUrl,
                iconUrl: req.input.iconUrl ?? "",
                redirectUris,
                scopes: requestedScopes,
                createdByUserId: caller.id
            });

            return apiOk({ app: dtoOAuthApp(client), clientSecret });
        }),

    getAllApps: os.getAllApps
        .use(requiredAuth("ADMIN"))
        .handler(async (req) => {
            const apps = await database.serviceClient.findMany({
                include: { createdByUser: true },
                orderBy: { createdAt: "desc" }
            });

            return apiOk({
                apps: apps.map(dtoOAuthApp)
            });
        }),

    updateAppTrustLevel: os.updateAppTrustLevel
        .use(requiredAuth("ADMIN"))
        .handler(async (req) => {
            const caller = req.context.user;

            const app = await database.serviceClient.findUnique({
                where: { id: req.input.id }
            });
    
            if (!app)
                return apiErr("NOT_FOUND", `App with ID ${req.input.id} not found.`);
    
            const updated = await database.serviceClient.update({
                where: { id: req.input.id },
                data: { trustLevel: req.input.trustLevel }
            });

             await database.serviceClientReview.create({
                data: {
                    serviceClientId: req.input.id,
                    reviewedByUserId: caller.id,
                    status: req.input.trustLevel
                }
            });
    
            return apiOk({ trustLevel: updated.trustLevel });
        }),

    getOwnedOAuthGrants: os.getOwnedOAuthGrants
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const grants = await database.serviceGrant.findMany({
                include: { serviceClient: true },
                where: { userId: caller.id, revokedAt: null },
                orderBy: { createdAt: "desc" }
            });

            return apiOk({
                grants: grants.map(dtoOAuthGrant)
            });
        }),

    revokeOAuthGrant: os.revokeOAuthGrant
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const grant = await database.serviceGrant.findUnique({
                where: { id: req.input.grantId }
            });

            if (!grant)
                return apiErr("NOT_FOUND", `Grant with ID ${req.input.grantId} not found.`);

            if (grant.userId !== caller.id)
                return apiErr("NO_PERMISSION", "You do not have permission to revoke this grant.");

            await database.serviceGrant.update({
                where: { id: req.input.grantId },
                data: { revokedAt: new Date() }
            });

            return apiOk({});
        })
});
