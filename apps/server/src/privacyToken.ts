import { createPublicKey, type KeyObject, type webcrypto } from "node:crypto";
import jwt from "jsonwebtoken";

import { database } from "@/db.js";
import { env } from "@/env.js";

const ISSUER = "hackclub-privacy";
const AUDIENCE = "lapse";
const DEFAULT_JWKS_URL = "https://yeet.hackclub.com/.well-known/jwks.json";
const MAX_LIFETIME_SECONDS = 300;
const LEEWAY_SECONDS = 30;
const JWKS_TTL_MS = 300_000;
const UNKNOWN_KID_REFETCH_MS = 30_000;
const TOKEN_USE_RETENTION_MS = 86_400_000;

export type PrivacyAction = "delete" | "export";

export type PrivacySubject = {
    emails: string[];
    slackId: string | null;
    identityId: string | null;
};

export type PrivacyClaims = {
    requestId: string;
    jti: string;
    action: PrivacyAction;
    dryRun: boolean;
    subject: PrivacySubject;
};

/**
 * A token the privacy hub sent that we refuse. `code` is short snake_case and is safe to return and log.
 */
export class PrivacyTokenError extends Error {
    constructor(public readonly code: string) {
        super(`Privacy token rejected: ${code}`);
    }
}

let keys = new Map<string, KeyObject>();
let fetchedAt = 0;

/**
 * Verifies an ES256 token signed by the Hack Club privacy hub against its published JWKS. Programs act on these claims
 * only, never on the request body.
 */
export async function verifyPrivacyToken(token: string | undefined): Promise<PrivacyClaims> {
    if (!token)
        throw new PrivacyTokenError("missing_token");

    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded.payload === "string")
        throw new PrivacyTokenError("malformed");

    if (decoded.header.alg !== "ES256" || decoded.header.typ !== "JWT" || !decoded.header.kid)
        throw new PrivacyTokenError("invalid_header");

    const key = await keyFor(decoded.header.kid);

    let payload: jwt.JwtPayload;
    try {
        const verified = jwt.verify(token, key, {
            algorithms: ["ES256"],
            issuer: ISSUER,
            audience: AUDIENCE,
            clockTolerance: LEEWAY_SECONDS,
            complete: true
        });

        if (typeof verified.payload === "string")
            throw new PrivacyTokenError("malformed");

        payload = verified.payload;
    }
    catch (error) {
        if (error instanceof PrivacyTokenError)
            throw error;

        throw new PrivacyTokenError(error instanceof jwt.TokenExpiredError ? "expired" : "invalid_token");
    }

    return claimsFrom(payload);
}

/**
 * Records a verified token's `jti` and returns whether this is its first use. Kept in Postgres rather than Redis, as an
 * unavailable cache would otherwise make every token look replayed.
 */
export async function firstUseOf(jti: string): Promise<boolean> {
    await database().privacyTokenUse.deleteMany({
        where: { usedAt: { lt: new Date(Date.now() - TOKEN_USE_RETENTION_MS) } }
    });

    const { count } = await database().privacyTokenUse.createMany({
        data: [{ jti }],
        skipDuplicates: true
    });

    return count === 1;
}

function claimsFrom(payload: jwt.JwtPayload): PrivacyClaims {
    const { iat, exp, jti } = payload;
    if (typeof iat !== "number" || typeof exp !== "number" || exp - iat > MAX_LIFETIME_SECONDS)
        throw new PrivacyTokenError("invalid_lifetime");

    if (iat > Date.now() / 1000 + LEEWAY_SECONDS)
        throw new PrivacyTokenError("issued_in_future");

    if (typeof jti !== "string" || jti.length === 0)
        throw new PrivacyTokenError("invalid_jti");

    const requestId: unknown = payload["request_id"];
    const action: unknown = payload["action"];
    const dryRun: unknown = payload["dry_run"];
    const subject: unknown = payload["subject"];

    if (typeof requestId !== "string" || requestId.length === 0)
        throw new PrivacyTokenError("invalid_request_id");

    if (action !== "delete" && action !== "export")
        throw new PrivacyTokenError("invalid_action");

    if (typeof dryRun !== "boolean")
        throw new PrivacyTokenError("invalid_dry_run");

    return { requestId, jti, action, dryRun, subject: subjectFrom(subject) };
}

function subjectFrom(value: unknown): PrivacySubject {
    if (typeof value !== "object" || value === null)
        throw new PrivacyTokenError("invalid_subject");

    const emails: unknown = Reflect.get(value, "emails");
    const slackId: unknown = Reflect.get(value, "slack_id");
    const identityId: unknown = Reflect.get(value, "identity_id");

    if (!Array.isArray(emails) || !emails.every(email => typeof email === "string" && email.length > 0))
        throw new PrivacyTokenError("invalid_subject");

    if ((slackId !== null && typeof slackId !== "string") || (identityId !== null && typeof identityId !== "string"))
        throw new PrivacyTokenError("invalid_subject");

    if (emails.length === 0 && !slackId && !identityId)
        throw new PrivacyTokenError("invalid_subject");

    return {
        emails: emails.map(email => email.toLowerCase()),
        slackId: slackId || null,
        identityId: identityId || null
    };
}

async function keyFor(kid: string): Promise<KeyObject> {
    const now = Date.now();
    if (now - fetchedAt > JWKS_TTL_MS || (!keys.has(kid) && now - fetchedAt > UNKNOWN_KID_REFETCH_MS))
        await refreshKeys();

    const key = keys.get(kid);
    if (!key)
        throw new PrivacyTokenError("unknown_kid");

    return key;
}

async function refreshKeys() {
    let body: unknown;
    try {
        const response = await fetch(env.PRIVACY_JWKS_URL ?? DEFAULT_JWKS_URL, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok)
            throw new PrivacyTokenError("jwks_unavailable");

        body = await response.json();
    }
    catch {
        throw new PrivacyTokenError("jwks_unavailable");
    }

    const published: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "keys") : null;
    if (!Array.isArray(published))
        throw new PrivacyTokenError("jwks_unavailable");

    const next = new Map<string, KeyObject>();
    for (const jwk of published) {
        if (!isSigningKey(jwk))
            continue;

        try {
            next.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
        }
        catch {
            continue;
        }
    }

    keys = next;
    fetchedAt = Date.now();
}

function isSigningKey(jwk: unknown): jwk is webcrypto.JsonWebKey & { kid: string } {
    if (typeof jwk !== "object" || jwk === null)
        return false;

    const field = (name: string): unknown => Reflect.get(jwk, name);
    return field("kty") === "EC"
        && field("crv") === "P-256"
        && typeof field("kid") === "string"
        && (field("alg") === undefined || field("alg") === "ES256")
        && (field("use") === undefined || field("use") === "sig");
}
