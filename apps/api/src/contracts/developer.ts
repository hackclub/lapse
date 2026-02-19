import { z } from "zod";

import { apiResult } from "@/common";
import { contract, NO_INPUT, NO_OUTPUT } from "@/internal";

/**
 * Represents the trust level of an Lapse OAuth app - `TRUSTED` apps do not show any warnings
 * when authenticating and may access more sensitive data.
 */
export type OAuthTrustLevel = z.infer<typeof OAuthTrustLevelSchema>;
export const OAuthTrustLevelSchema = z.literal(["UNTRUSTED", "TRUSTED"]);

/**
 * Represents an registered OAuth2 application on Lapse.
 */
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

export type OAuthGrant = {
    id: string;
    serviceClientId: string;
    serviceName: string;
    scopes: string[];
    createdAt: string;
    lastUsedAt: string | null;
};

export const developerRouterContract = {
    rotateAppSecret: contract()
        .route({ summary: "Rotates the secret for an OAuth app owned by the calling user." })
        .input(z.object({
            id: OAuthAppIdSchema
                .describe("The app ID to rotate the secret for.")
        }))
        .output(apiResult({
            clientSecret: z.string()
                .describe("The new client secret assigned to the app.")
        })),

    updateApp: contract()
        .route({ summary: "Updates data associated with an OAuth app owned by the calling user by its ID." })
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
        })),

    revokeApp: contract()
        .route({ summary: "Revokes an OAuth app owned by the calling user, permanently disallowing any user from authenticating through it." })
        .input(z.object({
            id: z.string()
                .describe("The ID of the app to revoke.")
        }))
        .output(NO_OUTPUT),

    getAllOwnedApps: contract()
        .route({ summary: "Gets all OAuth apps owned by the calling user." })
        .input(NO_INPUT)
        .output(apiResult({
            apps: OAuthAppSchema.array()
        })),

    createApp: contract()
        .route({ summary: "Creates a new OAuth app." })
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
        })),

    getAllApps: contract()
        .route({ summary: "Gets all OAuth apps created by any user. This procedure requires administrator access." })
        .input(NO_INPUT)
        .output(apiResult({
            apps: z.array(OAuthAppSchema)
        })),

    updateAppTrustLevel: contract()
        .route({ summary: "Updates the trust level of an OAuth app. This procedure requires administrator access." })
        .input(z.object({
            id: OAuthAppIdSchema
                .describe("The app ID to update."),
                
            trustLevel: OAuthTrustLevelSchema
                .describe("The new trust level.")
        }))
        .output(apiResult({
            trustLevel: OAuthTrustLevelSchema
        })),

    getOwnedOAuthGrants: contract()
        .route({ summary: "Gets all OAuth grants for the authenticated user." })
        .input(NO_INPUT)
        .output(apiResult({
            grants: z.array(z.object({
                id: z.string(),
                serviceClientId: z.string(),
                serviceName: z.string(),
                scopes: z.array(z.string()),
                createdAt: z.string(),
                lastUsedAt: z.string().nullable()
            }))
        })),

    revokeOAuthGrant: contract()
        .route({ summary: "Revokes an OAuth grant for the authenticated user." })
        .input(z.object({
            grantId: z.string()
                .describe("The ID of the grant to revoke.")
        }))
        .output(NO_OUTPUT)
};
