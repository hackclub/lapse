import "@/server/allow-only-server";

import jwt from "jsonwebtoken";
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { NextApiRequest } from "next";

import * as db from "@/generated/prisma/client";
import { env } from "@/server/env";
import { database } from "@/server/db";

export interface JWTPayload {
    userId: string;
    email: string;
    iat: number;
    exp: number;
}

export interface OboJWTPayload {
    userId: string;
    email: string;
    actorId: string;
    scopes: string[];
    iat: number;
    exp: number;
    aud: string;
    iss: string;
}

export interface OAuthCodePayload {
    userId: string;
    clientId: string;
    scopes: string[];
    redirectUri: string;
    type: "oauth_code";
    iat: number;
    exp: number;
}

export const OBO_AUDIENCE = "lapse-rest";
export const OBO_ISSUER = "lapse";
const OAUTH_CODE_TYPE = "oauth_code";

export function generateJWT(userId: string, email: string): string {
    return jwt.sign({ userId, email }, env.JWT_SECRET, { expiresIn: "30d" });
}

export function generateOboJWT(
    userId: string,
    email: string,
    actorId: string,
    scopes: string[],
    ttlSeconds: number,
): string {
    return jwt.sign(
        {
            userId,
            email,
            actorId,
            scopes,
            aud: OBO_AUDIENCE,
            iss: OBO_ISSUER,
        },
        env.JWT_SECRET,
        { expiresIn: ttlSeconds }
    );
}

export function generateOAuthCode(
    userId: string,
    clientId: string,
    scopes: string[],
    redirectUri: string,
    ttlSeconds: number,
): string {
    return jwt.sign(
        {
            type: OAUTH_CODE_TYPE,
            userId,
            clientId,
            scopes,
            redirectUri,
        },
        env.JWT_SECRET,
        { expiresIn: ttlSeconds }
    );
}

export function verifyJWT(token: string): JWTPayload | null {
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
        return decoded as JWTPayload;
    }
    catch {
        return null;
    }
}

export function verifyOboJWT(token: string): OboJWTPayload | null {
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET, {
            audience: OBO_AUDIENCE,
            issuer: OBO_ISSUER,
        }) as jwt.JwtPayload;

        const payload = decoded as OboJWTPayload;
        if (!payload.actorId || !payload.userId || !payload.scopes)
            return null;

        if (!Array.isArray(payload.scopes))
            return null;

        const scopes = payload.scopes
            .filter((scope): scope is string => typeof scope === "string")
            .map((scope) => scope.trim())
            .filter(Boolean);

        if (scopes.length === 0 || scopes.length !== new Set(scopes).size)
            return null;

        return {
            ...payload,
            scopes,
        };
    } catch {
        return null;
    }
}

export function verifyOAuthCode(token: string): OAuthCodePayload | null {
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;

        const payload = decoded as OAuthCodePayload;
        if (payload.type !== OAUTH_CODE_TYPE)
            return null;

        if (!payload.clientId || !payload.userId || !payload.redirectUri || !payload.scopes)
            return null;

        if (!Array.isArray(payload.scopes))
            return null;

        const scopes = payload.scopes
            .filter((scope): scope is string => typeof scope === "string")
            .map((scope) => scope.trim())
            .filter(Boolean);

        if (scopes.length === 0 || scopes.length !== new Set(scopes).size)
            return null;

        return {
            ...payload,
            scopes,
        };
    }
    catch {
        return null;
    }
}

function hasOboClaims(token: string) {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== "object")
        return false;

    const payload = decoded as Record<string, unknown>;
    return (
        payload.actorId !== undefined ||
        payload.aud === OBO_AUDIENCE ||
        payload.iss === OBO_ISSUER
    );
}

export function hashServiceSecret(secret: string): string {
    const salt = randomBytes(16).toString("hex");
    const hashed = scryptSync(secret, salt, 64).toString("hex");
    return `${salt}:${hashed}`;
}

export async function verifyServiceSecret(secret: string, stored: string): Promise<boolean> {
    const [salt, hashed] = stored.split(":");
    if (!salt || !hashed)
        return false;

    const derived = await new Promise<Buffer<ArrayBuffer>>((resolve, reject) => {
        scrypt(secret, salt, 64, (err, val) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(val);
            } 
        });
    });

    const storedBuffer = Buffer.from(hashed, "hex");
    if (derived.length !== storedBuffer.length)
        return false;

    return timingSafeEqual(derived, storedBuffer);
}

export async function getAuthenticatedUser(req: NextApiRequest) {
    const token = extractJWTFromRequest(req);

    if (!token)
        return null;

    // Reject OAuth tokens in tRPC - only regular user sessions allowed
    if (hasOboClaims(token))
        return null;

    const payload = verifyJWT(token);
    if (!payload)
        return null;

    try {
        const user = await database.user.findFirst({
            where: { id: payload.userId },
        });

        return user;
    } catch (error) {
        console.error("(auth.ts)", "Failed to fetch authenticated user:", error);
        return null;
    }
}

export type RestAuthContext = {
    user: db.User | null;
    actor: db.ServiceClient | null;
    scopes: string[];
};

export async function getRestAuthContext(
    req: NextApiRequest,
): Promise<RestAuthContext> {
    const token = extractJWTFromRequest(req);

    if (!token)
        return { user: null, actor: null, scopes: [] };

    const oboPayload = verifyOboJWT(token);
    if (oboPayload) {
        try {
            const [user, actor] = await Promise.all([
                database.user.findFirst({ where: { id: oboPayload.userId } }),
                database.serviceClient.findFirst({
                    where: { id: oboPayload.actorId, revokedAt: null },
                }),
            ]);

            if (!user || !actor)
                return { user: null, actor: null, scopes: [] };

            return { user, actor, scopes: oboPayload.scopes };
        } catch (error) {
            console.error("(auth.ts)", "Failed to fetch OBO auth context:", error);
            return { user: null, actor: null, scopes: [] };
        }
    }

    if (hasOboClaims(token))
        return { user: null, actor: null, scopes: [] };

    const payload = verifyJWT(token);
    if (!payload)
        return { user: null, actor: null, scopes: [] };

    try {
        const user = await database.user.findFirst({
            where: { id: payload.userId },
        });

        return { user, actor: null, scopes: [] };
    } catch (error) {
        console.error("(auth.ts)", "Failed to fetch authenticated user:", error);
        return { user: null, actor: null, scopes: [] };
    }
}

export function extractJWTFromRequest(req: NextApiRequest): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer "))
        return authHeader.substring(7);

    const cookies = req.headers.cookie;
    if (cookies) {
        const match = cookies.match(/lapse-auth=([^;]+)/);
        if (match) {
            return match[1];
        }
    }

    return null;
}
