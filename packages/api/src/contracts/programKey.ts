import { z } from "zod";

import { apiResult } from "@/common";
import { contract, NO_INPUT, NO_OUTPUT } from "@/internal";

/**
 * Represents the metadata of a program key (never includes the raw key value).
 */
export type ProgramKeyMetadata = z.infer<typeof ProgramKeyMetadataSchema>;
export const ProgramKeyMetadataSchema = z.object({
    id: z.uuid(),
    name: z.string().min(1).max(64),
    keyPrefix: z.string(),
    scopes: z.array(z.string()),
    createdBy: z.object({
        id: z.string(),
        handle: z.string(),
        displayName: z.string()
    }),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    expiresAt: z.string()
});

export const programKeyRouterContract = {
    create: contract()
        .route({ description: "Creates a new program key. The raw key is only returned with this response or when rotating. Requires ROOT access." })
        .input(z.object({
            name: ProgramKeyMetadataSchema.shape.name
                .describe("A human-readable name for the key."),
            scopes: z.array(z.string())
                .describe("The scopes to grant to this key."),
            expiresAt: z.number()
                .describe("Expiration timestamp in milliseconds since Unix epoch. Must be within 1 year from now.")
        }))
        .output(apiResult({
            key: ProgramKeyMetadataSchema
                .describe("The created program key metadata."),
            rawKey: z.string()
                .describe("The raw program key — this will only be shown once.")
        })),

    list: contract()
        .route({ description: "Lists all program keys. Requires ROOT access." })
        .input(NO_INPUT)
        .output(apiResult({
            keys: z.array(ProgramKeyMetadataSchema)
        })),

    rotate: contract()
        .route({ description: "Rotates a program key, generating a new raw key. The old key is immediately invalidated. Requires ROOT access." })
        .input(z.object({
            id: z.uuid()
                .describe("The ID of the program key to rotate.")
        }))
        .output(apiResult({
            key: ProgramKeyMetadataSchema
                .describe("The updated program key metadata."),
            rawKey: z.string()
                .describe("The new raw program key — this will only be shown once.")
        })),

    revoke: contract()
        .route({ description: "Revokes a program key, permanently disabling it. Requires ROOT access." })
        .input(z.object({
            id: z.uuid()
                .describe("The ID of the program key to revoke.")
        }))
        .output(NO_OUTPUT),

    scopes: contract("GET", "/programKey/scopes")
        .route({ description: "Lists all available program key scopes with descriptions. Requires ROOT access." })
        .input(NO_INPUT)
        .output(apiResult({
            scopes: z.array(z.object({
                scope: z.string(),
                description: z.string(),
                group: z.string()
            }))
        })),

    updateScopes: contract()
        .route({ description: "Updates the scopes on an existing program key. Requires ROOT access." })
        .input(z.object({
            id: z.uuid()
                .describe("The ID of the program key to update."),
            scopes: z.array(z.string())
                .describe("The new set of scopes for this key.")
        }))
        .output(apiResult({
            key: ProgramKeyMetadataSchema
        }))
};
