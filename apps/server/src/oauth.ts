import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import OAuth2Server from "@node-oauth/oauth2-server";
import { assert } from "@hackclub/lapse-shared";
import z from "zod";
import jwt from "jsonwebtoken";

import * as db from "@/generated/prisma/client.js";

import { database, redis } from "@/db.js";
import { env } from "@/env.js";
import { logInfo, logWarning } from "@/logging.js";
import type { FastifyRequest } from "fastify";
import { getAllOAuthScopes, type LapseOAuthScope } from "@hackclub/lapse-api";
import type { ExternalActor, AuthenticatedProgramKey } from "@/ownership.js";

export function hashServiceSecret(secret: string): string {
    const salt = randomBytes(16).toString("hex");
    const hashed = scryptSync(secret, salt, 64).toString("hex");
    return `${salt}:${hashed}`;
}

export function generateServiceClientId() {
    return `svc_${randomBytes(12).toString("hex")}`;
}

export function generateServiceClientSecret() {
    return `scs_${randomBytes(24).toString("hex")}`;
}

const PROGRAM_KEY_PREFIX = "pk_lapse_";

export function generateProgramKey() {
    return `${PROGRAM_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
}

/**
 * Extracts the key prefix (first 8 hex chars after `pk_lapse_`) from a raw program key.
 */
export function extractProgramKeyPrefix(rawKey: string): string {
    return rawKey.substring(PROGRAM_KEY_PREFIX.length, PROGRAM_KEY_PREFIX.length + 8);
}

/**
 * Verifies a raw secret against a stored scrypt hash in `salt:hash` format.
 */
export function verifySecretHash(secret: string, storedHash: string): boolean {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) return false;

    const computed = scryptSync(secret, salt, 64);
    const stored = Buffer.from(hash, "hex");
    if (computed.length !== stored.length) return false;

    return timingSafeEqual(computed, stored);
}

export async function createServiceClient(params: {
    name: string
    description: string
    homepageUrl: string
    iconUrl: string
    redirectUris: string[]
    scopes: string[]
    createdByUserId: string
}) {
    const clientId = generateServiceClientId();
    const clientSecret = generateServiceClientSecret();

    const client = await database().serviceClient.create({
        include: { createdByUser: true },
        data: {
            name: params.name,
            description: params.description,
            homepageUrl: params.homepageUrl,
            iconUrl: params.iconUrl,
            redirectUris: params.redirectUris,
            scopes: params.scopes,
            clientId,
            clientSecretHash: hashServiceSecret(clientSecret),
            createdByUserId: params.createdByUserId
        }
    });

    return { client, clientSecret };
}

export async function rotateServiceClientSecret(serviceClientId: string) {
    const clientSecret = generateServiceClientSecret();

    const client = await database().serviceClient.update({
        where: { id: serviceClientId },
        data: {
            clientSecretHash: hashServiceSecret(clientSecret)
        }
    });

    return { client, clientSecret };
}

export function normalizeRedirectUris(raw: string[]) {
    return raw
        .map(uri => uri.trim())
        .filter(Boolean);
}

export function normalizeScopes(raw: string[]) {
    return raw
        .map(scope => scope.trim())
        .filter(Boolean);
}

function decodeAccessToken(accessToken: string): AccessTokenJwt | Error {
    try {
        return AccessTokenJwtSchema.parse(
            jwt.verify(accessToken, env.JWT_SECRET_ACCESS_TOKENS)
        );
    }
    catch (err) {
        logWarning("Access token is either expired, forged, or has an incorrect schema.", { err });
        return err as Error;
    }
}

/**
 * Defines the fields of an authorization code stored on Redis.
 */
type AuthorizationCodePayload = z.infer<typeof AuthorizationCodePayloadSchema>;
const AuthorizationCodePayloadSchema = z.object({
    /**
     * The user ID the authorization code was issued for.
     */
    sub: z.string(),

    /**
     * The client ID the authorization code was issued for.
     */
    cid: z.string(),

    /**
     * The scopes to grant to the authentication token that will result from this authorization code.
     */
    scp: z.array(z.string()).optional(),

    /**
     * The redirect URI for the code.
     */
    uri: z.string(),

    /**
     * Code challenge value.
     */
    ccv: z.string().optional(),

    /**
     * Code challenge method.
     */
    ccm: z.string().optional(),

    /**
     * The expiration date of the authorization code, specified in milliseconds from the Unix epoch.
     */
    exp: z.number()
});

/**
 * Defines the fields of an access token stored as a JWT.
 */
type AccessTokenPayload = z.infer<typeof AccessTokenPayloadSchema>;
const AccessTokenPayloadSchema = z.object({
    /**
     * The ID of the user the access token was issued for.
     */
    sub: z.string(),

    /**
     * The scopes the caller is entitled to.
     */
    scp: z.array(z.string()),

    /**
     * The client ID this access token was generated for.
     */
    cid: z.string()
});

/**
 * Extends `AccessTokenPayload` with fields automatically generated by `jsonwebtoken`.
 */
type AccessTokenJwt = z.infer<typeof AccessTokenJwtSchema>;
const AccessTokenJwtSchema = AccessTokenPayloadSchema.extend({
    /**
     * The expiration date of the authorization code, specified in seconds from the Unix epoch. 
     */
    exp: z.number()
})

/**
 * Ensures the canonical OAuth client exists.
 */
export async function ensureCanonicalClient() {
    const clientId = env.CANONICAL_OAUTH_CLIENT_ID;
    const redirectUris = env.CANONICAL_OAUTH_CLIENT_REDIRECT_URIS
        .split(",")
        .map(u => u.trim())
        .filter(Boolean);

    const data = {
        name: env.CANONICAL_OAUTH_CLIENT_NAME,
        description: env.CANONICAL_OAUTH_CLIENT_DESCRIPTION,
        homepageUrl: env.CANONICAL_OAUTH_CLIENT_HOMEPAGE_URL,
        redirectUris,
        scopes: ["elevated"],
        trustLevel: "TRUSTED" as const,
    };

    const existing = await database().serviceClient.findUnique({
        where: { clientId }
    });

    if (existing) {
        await database().serviceClient.update({
            where: { clientId },
            data
        });

        logInfo(`Updated canonical OAuth client (${clientId}).`);
    }
    else {
        const clientSecret = generateServiceClientSecret();
        const clientSecretHash = hashServiceSecret(clientSecret);

        await database().serviceClient.create({
            data: {
                ...data,
                clientId,
                clientSecretHash,
            }
        });

        logInfo(`Created canonical OAuth client (${clientId}).`);
        logInfo(`Client secret: ${clientSecret}`);
        logInfo(`Save this secret - it will not be shown again!`);
    }
}

// reference: https://github.com/14gasher/oauth-example/blob/master/auth/oauth/model.js

class LapseAuthorizationCodeModel implements OAuth2Server.AuthorizationCodeModel {
    private async clientById(clientId: string) {
        const client = await database().serviceClient.findFirst({
            where: { clientId },
            include: { grants: true }
        });

        return client && !client.revokedAt ? this.dtoDbClient(client) : null;
    }

    private dtoDbClient(client: db.ServiceClient): OAuth2Server.Client {
        return {
            id: client.clientId,
            redirectUris: client.redirectUris,
            grants: ["authorization_code", "refresh_token"]
        };
    }

    async getClient(clientId: string, clientSecret: string | null): Promise<OAuth2Server.Client | OAuth2Server.Falsey> {
        const client = await database().serviceClient.findFirst({
            include: { grants: true },
            where: {
                clientId
            }
        });

        if (!client) {
            logWarning(`Attempted to find a non-existent client ${clientId}.`);
            return null;
        }

        // Only verify the secret if one was provided (during token endpoint)
        if (clientSecret) {
            const expectedHash = hashServiceSecret(clientSecret);
            if (client.clientSecretHash !== expectedHash) {
                logWarning(`Client secret mismatch for client ${clientId}.`);
                return null;
            }
        }

        return this.dtoDbClient(client);
    }

    async saveAuthorizationCode(
        code: Pick<OAuth2Server.AuthorizationCode, "authorizationCode" | "expiresAt" | "redirectUri" | "scope" | "codeChallenge" | "codeChallengeMethod">,
        client: OAuth2Server.Client,
        user: OAuth2Server.User
    ): Promise<OAuth2Server.AuthorizationCode | OAuth2Server.Falsey> {
        await redis().set(
            `lapse:auth:authcode:${code.authorizationCode}`,
            JSON.stringify(
                {
                    cid: client.id,
                    sub: user["id"],
                    scp: code.scope,
                    uri: code.redirectUri,
                    ccv: code.codeChallenge,
                    ccm: code.codeChallengeMethod,
                    exp: code.expiresAt.getTime()
                } satisfies AuthorizationCodePayload
            ),
            "PXAT", code.expiresAt.getTime() // PXAT = expires at, milliseconds, unix time
        );

        return {
            client,
            user,
            authorizationCode: code.authorizationCode,
            expiresAt: code.expiresAt,
            redirectUri: code.redirectUri,
            codeChallenge: code.codeChallenge,
            codeChallengeMethod: code.codeChallengeMethod,
            scope: code.scope
        };
    }

    async getAuthorizationCode(authorizationCode: string): Promise<OAuth2Server.AuthorizationCode | OAuth2Server.Falsey> {
        const raw = await redis().get(`lapse:auth:authcode:${authorizationCode}`);
        if (!raw) {
            logWarning(`Could not get OAuth authorization code - ${authorizationCode} is either expired or doesn't exist.`);
            return null;
        }

        let payload: AuthorizationCodePayload;

        try {
            payload = AuthorizationCodePayloadSchema.parse(JSON.parse(raw));
        }
        catch (err) {
            logWarning(`OAuth authorization code ${authorizationCode} stored in Redis is malformed!`, { err });
            return null;
        }

        const client = await this.clientById(payload.cid);
        if (!client) {
            logWarning(`The client ${payload.cid} that issued authorization code ${authorizationCode} either doesn't exist or has been revoked.`, { payload });
            return null;
        }

        return {
            authorizationCode,
            client,
            expiresAt: new Date(payload.exp),
            redirectUri: payload.uri,
            codeChallenge: payload.ccv,
            codeChallengeMethod: payload.ccm,
            scope: payload.scp,
            user: {
                id: payload.sub
            }
        };
    }

    async revokeAuthorizationCode(code: OAuth2Server.AuthorizationCode): Promise<boolean> {
        return (await redis().del(`lapse:auth:authcode:${code.authorizationCode}`)) == 1;
    }

    // We take control of access token generation, as those are JWTs in our case. This allows us to skip hitting the database every single time we want to check user authorization - but, as we store the
    // issued-at date for each JWT, we can store a `tokensValidFrom` on our `User` model (which we fetch anyways for each authenticated request) for immidiate revocation of all tokens in case a
    // user gets compromised.
    async generateAccessToken(client: OAuth2Server.Client, user: OAuth2Server.User, scope: string[]): Promise<string> {
        assert("id" in user && typeof user["id"] === "string", "'user' object provided to generateAccessToken was invalid");

        return jwt.sign(
            {
                sub: user["id"],
                cid: client.id,
                scp: scope
            } satisfies AccessTokenPayload,
            env.JWT_SECRET_ACCESS_TOKENS,
            { expiresIn: "30d" } // TODO: We currently don't do refresh tokens. We should probably do that.
        );
    }

    async saveToken(token: OAuth2Server.Token, client: OAuth2Server.Client, user: OAuth2Server.User): Promise<OAuth2Server.Token | OAuth2Server.Falsey> {
        // Our tokens are JWTs, so there's no need to save them. We still do a sanity check on them - just in case!
        return this.getAccessToken(token.accessToken);
    }

    async getAccessToken(accessToken: string): Promise<OAuth2Server.Token | OAuth2Server.Falsey> {
        let token: AccessTokenJwt | string;

        try {
            token = AccessTokenJwtSchema.parse(
                jwt.verify(accessToken, env.JWT_SECRET_ACCESS_TOKENS)
            );
        }
        catch (err) {
            logWarning("Access token is either expired, forged, or has an incorrect schema.", { err });
            return null;
        }

        const client = await this.clientById(token.cid);
        if (!client) {
            logWarning(`The client ${token.cid} that issued access token for user ${token.sub} either doesn't exist or has been revoked.`, { token });
            return null;
        }

        return {
            accessToken,
            accessTokenExpiresAt: new Date(token.exp * 1000),
            client,
            scope: token.scp,
            user: {
                id: token.sub
            }
        };
    }
}

export const oauthSrv = new OAuth2Server({
    model: new LapseAuthorizationCodeModel(),
    accessTokenLifetime: 60 * 60 * 24 * 30, // 30d
});

export async function getAuthenticatedUser(req: FastifyRequest): Promise<ExternalActor | null> {
    if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer "))
        return null;

    const bearerToken = req.headers.authorization.substring("Bearer ".length);

    if (bearerToken.startsWith(PROGRAM_KEY_PREFIX)) {
        const programKey = await authenticateProgramKey(bearerToken);
        if (!programKey) return null;
        return { kind: "PROGRAM", programKey };
    }

    const token = decodeAccessToken(bearerToken);
    if (token instanceof Error) {
        logWarning("Could not decode access token!", { error: token });
        return null;
    }

    try {
        const user = await database().user.findFirst({
            where: { id: token.sub }
        });

        if (!user) return null;

        const allScopes = new Set(getAllOAuthScopes());
        if (!token.scp.every(x => allScopes.has(x as LapseOAuthScope))) {
            logWarning(`Unknown scopes present in access token; denying auth! All scopes: ${token.scp.join(", ")}`);
            return null;
        }

        return { kind: "USER", user, scopes: token.scp as LapseOAuthScope[] };
    }
    catch (error) {
        logWarning(`Could not fetch user ${token.sub} (authenticated via client ${token.cid})!`, { error });
        return null;
    }
}

async function authenticateProgramKey(bearerToken: string): Promise<AuthenticatedProgramKey | null> {
    const prefix = extractProgramKeyPrefix(bearerToken);

    const candidates = await database().programKey.findMany({
        where: {
            keyPrefix: prefix,
            revokedAt: null,
            expiresAt: { gt: new Date() }
        }
    });

    for (const candidate of candidates) {
        if (verifySecretHash(bearerToken, candidate.keyHash)) {
            // Update lastUsedAt (fire-and-forget)
            database().programKey.update({
                where: { id: candidate.id },
                data: { lastUsedAt: new Date() }
            }).catch(() => {});

            return {
                id: candidate.id,
                name: candidate.name,
                scopes: candidate.scopes as LapseOAuthScope[]
            };
        }
    }

    logWarning(`Program key with prefix ${prefix} failed verification.`);
    return null;
}
