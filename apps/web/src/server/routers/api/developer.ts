import "@/server/allow-only-server";

import { z } from "zod";

import { router, protectedProcedure, adminProcedure } from "@/server/trpc";
import { database } from "@/server/db";
import { normalizeRedirectUris, normalizeScopes, rotateServiceClientSecret, createServiceClient } from "@/server/services/serviceClientService";

import { apiResult, apiErr, apiOk } from "@/shared/common";
import { getAllOAuthScopes } from "@/shared/oauthScopes";

import * as db from "@/generated/prisma/client";

export type OAuthTrustLevel = z.infer<typeof OAuthTrustLevelSchema>;
export const OAuthTrustLevelSchema = z.literal(["UNTRUSTED", "TRUSTED"]);

export type OAuthApp = z.infer<typeof OAuthAppSchema>;
export const OAuthAppSchema = z.object({
    id: z.uuid(),
    name: z.string().min(2).max(48),
    description: z.string().max(200),
    homepageUrl: z.url(),
    iconUrl: z.union([z.url(), z.literal("")]),
    redirectUris: z.array(z.url()),
    scopes: z.array(z.string()),
    trustLevel: OAuthTrustLevelSchema,
    clientId: z.string(),
    createdBy: z.object({
        id: z.string(),
        handle: z.string(),
        displayName: z.string()
    }),
    createdAt: z.string()
});

export const OAuthAppIdSchema = OAuthAppSchema.shape.id;

export type DbOAuthApp = db.ServiceClient & { createdByUser: db.User };

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

export type OAuthGrant = {
    id: string;
    serviceClientId: string;
    serviceName: string;
    scopes: string[];
    createdAt: string;
    lastUsedAt: string | null;
};

export type DbOAuthGrant = db.ServiceGrant & { serviceClient: db.ServiceClient };

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

export default router({
    rotateAppSecret: protectedProcedure()
        .summary("Rotates the secret for an OAuth app owned by the calling user.")
        .input(
            z.object({
                id: OAuthAppIdSchema
                    .describe("The app ID to rotate the secret for.")
            })
        )
        .output(
            apiResult({
                clientSecret: z.string()
                    .describe("The new client secret assigned to the app.")
            })
        )
        .mutation(async (req) => {
            const app = await database.serviceClient.findFirst({
                where: {
                    id: req.input.id,
                    createdByUserId: req.ctx.user.id,
                    revokedAt: null
                }
            });

            if (!app)
                return apiErr("NOT_FOUND", `App with ID ${req.input.id} not found.`);

            const { clientSecret } = await rotateServiceClientSecret(app.id);
            return apiOk({ clientSecret });
        }),

    updateApp: protectedProcedure()
        .summary("Updates data associated with an OAuth app owned by the calling user by its ID.")
        .input(
            z.object({
                id: OAuthAppIdSchema
                    .describe("The app ID to update the information of."),

                name: OAuthAppSchema.shape.name.optional(),
                description: OAuthAppSchema.shape.description.optional(),
                homepageUrl: OAuthAppSchema.shape.homepageUrl.optional(),
                iconUrl: OAuthAppSchema.shape.iconUrl.optional(),
                redirectUris: OAuthAppSchema.shape.redirectUris.optional(),
                scopes: OAuthAppSchema.shape.scopes.optional()
            })
        )
        .output(apiResult({
            app: OAuthAppSchema
        }))
        .mutation(async (req) => {
            const app = await database.serviceClient.findFirst({
                where: { id: req.input.id, createdByUserId: req.ctx.user.id, revokedAt: null }
            });
        
            if (!app)
                return apiErr("NOT_FOUND", `App with ID ${req.input.id} not found.`);
        
            let normalizedScopes: string[] | undefined = undefined;

            if (req.input.scopes) {
                const validScopes = new Set(getAllOAuthScopes());
                const requestedScopes = normalizeScopes(req.input.scopes);
                const invalidScopes = requestedScopes.filter(scope => !validScopes.has(scope));

                if (invalidScopes.length > 0)
                    return apiErr("ERROR", `Unknown scopes: ${invalidScopes.join(", ")}`)

                normalizedScopes = requestedScopes;
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

    revokeApp: protectedProcedure()
        .summary("Revokes an OAuth app owned by the calling user, permanently disallowing any user from authenticating through it.")
        .input(
            z.object({
                id: z.string()
                    .describe("The ID of the app to revoke.")
            })
        )
        .output(apiResult({}))
        .mutation(async (req) => {
            const app = await database.serviceClient.findFirst({
                where: { id: req.input.id, createdByUserId: req.ctx.user.id, revokedAt: null }
            });
        
            if (!app)
                return apiErr("NOT_FOUND", `App with ID ${req.input.id} not found.`);

            await database.serviceClient.update({
                where: { id: req.input.id },
                data: { revokedAt: new Date() }
            });
        
            return apiOk({});
        }),

    getAllOwnedApps: protectedProcedure()
        .summary("Gets all OAuth apps owned by the calling user.")
        .input(z.object({}))
        .output(apiResult({
            apps: OAuthAppSchema.array()
        }))
        .query(async (req) => {
            const apps = await database.serviceClient.findMany({
                where: { createdByUserId: req.ctx.user.id, revokedAt: null },
                orderBy: { createdAt: "desc" },
                include: { createdByUser: true },
            });

            return apiOk({ apps: apps.map(dtoOAuthApp) });
        }),

    createApp: protectedProcedure()
        .summary("Creates a new OAuth app.")
        .input(z.object({
            name: OAuthAppSchema.shape.name,
            description: OAuthAppSchema.shape.description.default(""),
            homepageUrl: OAuthAppSchema.shape.homepageUrl,
            iconUrl: OAuthAppSchema.shape.iconUrl,
            redirectUris: OAuthAppSchema.shape.redirectUris,
            scopes: OAuthAppSchema.shape.scopes
        }))
        .output(apiResult({
            app: OAuthAppSchema
                .describe("The created app."),

            clientSecret: z.string()
                .describe("The client secret for the app - this is not stored on the server, and will only be returned with this request or when rotating.")
        }))
        .mutation(async (req) => {
            const validScopes = new Set(getAllOAuthScopes());
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
                createdByUserId: req.ctx.user.id
            });

            return apiOk({ app: dtoOAuthApp(client), clientSecret });
        }),

    getAllApps: adminProcedure()
        .summary("Gets all OAuth apps created by any user. This procedure requires administrator access.")
        .input(z.object({}))
        .output(apiResult({
            apps: z.array(OAuthAppSchema)
        }))
        .query(async (req) => {
            const apps = await database.serviceClient.findMany({
                include: { createdByUser: true },
                orderBy: { createdAt: "desc" }
            });

            return apiOk({
                apps: apps.map(dtoOAuthApp)
            });
        }),

    updateAppTrustLevel: adminProcedure()
         .summary("Updates the trust level of an OAuth app. This procedure requires administrator access.")
         .input(
             z.object({
                 id: OAuthAppIdSchema
                     .describe("The app ID to update."),
                     
                 trustLevel: OAuthTrustLevelSchema
                     .describe("The new trust level.")
             })
         )
         .output(apiResult({
             trustLevel: OAuthTrustLevelSchema
         }))
         .mutation(async (req) => {
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
                    reviewedByUserId: req.ctx.user.id,
                    status: req.input.trustLevel
                }
            });
    
            return apiOk({ trustLevel: updated.trustLevel });
         }),

    getOwnedOAuthGrants: protectedProcedure()
        .summary("Gets all OAuth grants for the authenticated user.")
        .input(z.object({}))
        .output(apiResult({
            grants: z.array(z.object({
                id: z.string(),
                serviceClientId: z.string(),
                serviceName: z.string(),
                scopes: z.array(z.string()),
                createdAt: z.string(),
                lastUsedAt: z.string().nullable()
            }))
        }))
        .query(async (req) => {
            const grants = await database.serviceGrant.findMany({
                include: { serviceClient: true },
                where: { userId: req.ctx.user.id, revokedAt: null },
                orderBy: { createdAt: "desc" }
            });

            return apiOk({
                grants: grants.map(dtoOAuthGrant)
            });
        }),

    revokeOAuthGrant: protectedProcedure()
        .summary("Revokes an OAuth grant for the authenticated user.")
        .input(
            z.object({
                grantId: z.string()
                    .describe("The ID of the grant to revoke.")
            })
        )
        .output(apiResult({}))
        .mutation(async (req) => {
            const grant = await database.serviceGrant.findUnique({
                where: { id: req.input.grantId }
            });

            if (!grant)
                return apiErr("NOT_FOUND", `Grant with ID ${req.input.grantId} not found.`);

            if (grant.userId !== req.ctx.user.id)
                return apiErr("NO_PERMISSION", "You do not have permission to revoke this grant.");

            await database.serviceGrant.update({
                where: { id: req.input.grantId },
                data: { revokedAt: new Date() }
            });

            return apiOk({});
        })
    });
