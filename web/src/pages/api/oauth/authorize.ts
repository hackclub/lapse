import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { database } from "@/server/db";
import { generateOAuthCode } from "@/server/auth";
import { getRestAuthContext } from "@/server/auth";
import { getAllOAuthScopes } from "@/shared/oauthScopes";

const InitSchema = z.object({
    client_id: z.string(),
    redirect_uri: z.string().optional(),
    scope: z.array(z.string()).optional(),
    state: z.string().max(256).optional()
});

const ConsentSchema = z.object({
    client_id: z.string(),
    redirect_uri: z.string().optional(),
    scope: z.array(z.string()).optional(),
    state: z.string().max(256).optional(),
    consent: z.boolean()
});

const AUTH_CODE_TTL_SECONDS = 300;

function normalizeScopes(input: string[] | undefined): string[] {
    if (!input)
        return [];

    return input.map(scope => scope.trim()).filter(Boolean);
}

function getInvalidScopes(scopes: string[]) {
    const allowed = new Set(getAllOAuthScopes());
    return scopes.filter(scope => !allowed.has(scope));
}

function buildRedirectUrl(redirectUri: string | null, fragment: Record<string, string | undefined>) {
    if (!redirectUri)
        return null;

    const url = new URL(redirectUri);
    const params = new URLSearchParams(url.search);

    for (const [key, value] of Object.entries(fragment)) {
        if (value !== undefined)
            params.set(key, value);
    }

    url.search = params.toString();
    return url.toString();
}

function getRequestedScopes(requested: string[], allowed: string[]) {
    if (requested.length === 0)
        return allowed;

    return requested.filter(scope => allowed.includes(scope));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const authContext = await getRestAuthContext(req);
    if (!authContext.user || authContext.actor)
        return res.status(401).json({ ok: false, message: "Authentication required." });

    if (req.method === "POST") {
        const parsed = InitSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ ok: false, message: "Invalid authorization request." });

        const scopes = normalizeScopes(parsed.data.scope);
        const invalidScopes = getInvalidScopes(scopes);
        if (invalidScopes.length > 0)
            return res.status(400).json({ ok: false, message: `Unknown scopes: ${invalidScopes.join(", ")}` });

        const client = await database.serviceClient.findFirst({
            where: { clientId: parsed.data.client_id, revokedAt: null }
        });

        if (!client)
            return res.status(404).json({ ok: false, message: "Unknown client." });

        const redirectUri = parsed.data.redirect_uri ?? null;
        if (!redirectUri)
            return res.status(400).json({ ok: false, message: "Redirect URI required." });

        if (client.redirectUris.length === 0 || !client.redirectUris.includes(redirectUri))
            return res.status(400).json({ ok: false, message: "Invalid redirect URI." });

        const existingGrant = await database.serviceGrant.findFirst({
            where: {
                serviceClientId: client.id,
                userId: authContext.user.id,
                revokedAt: null
            }
        });

        if (existingGrant) {
            const existingScopes = existingGrant.scopes
                .map((scope) => scope.trim())
                .filter(Boolean);

            if (existingScopes.length === 0)
                return res.status(400).json({ ok: false, message: "Invalid stored grant scopes." });

            if (existingScopes.length !== new Set(existingScopes).size)
                return res.status(400).json({ ok: false, message: "Invalid stored grant scopes." });

            const code = generateOAuthCode(
                authContext.user.id,
                client.clientId,
                existingScopes,
                redirectUri,
                AUTH_CODE_TTL_SECONDS
            );

            const redirectUrl = buildRedirectUrl(redirectUri, {
                code,
                state: parsed.data.state
            });

            return res.status(200).json({
                ok: true,
                data: { redirectUrl, authorizationCode: code, grantId: existingGrant.id }
            });
        }

        return res.status(200).json({
            ok: true,
            data: {
                client: {
                    id: client.id,
                    name: client.name,
                    clientId: client.clientId,
                    scopes: client.scopes,
                    redirectUris: client.redirectUris,
                    trustLevel: client.trustLevel
                }
            }
        });
    }

    if (req.method === "PUT") {
        const parsed = ConsentSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ ok: false, message: "Invalid authorization request." });

        const scopes = normalizeScopes(parsed.data.scope);
        const invalidScopes = getInvalidScopes(scopes);
        if (invalidScopes.length > 0)
            return res.status(400).json({ ok: false, message: `Unknown scopes: ${invalidScopes.join(", ")}` });

        const client = await database.serviceClient.findFirst({
            where: { clientId: parsed.data.client_id, revokedAt: null }
        });

        if (!client)
            return res.status(404).json({ ok: false, message: "Unknown client." });

        const redirectUri = parsed.data.redirect_uri ?? null;
        if (!redirectUri)
            return res.status(400).json({ ok: false, message: "Redirect URI required." });

        if (client.redirectUris.length === 0 || !client.redirectUris.includes(redirectUri))
            return res.status(400).json({ ok: false, message: "Invalid redirect URI." });

        if (!parsed.data.consent) {
            const denyRedirect = buildRedirectUrl(redirectUri, {
                error: "access_denied",
                state: parsed.data.state
            });

            return res.status(200).json({ ok: true, data: { redirectUrl: denyRedirect } });
        }

        const allowedScopes = client.scopes;
        const requestedScopes = getRequestedScopes(scopes, allowedScopes);

        if (requestedScopes.length === 0)
            return res.status(400).json({ ok: false, message: "Requested scopes are not allowed." });

        const normalizedScopes = requestedScopes.map((scope) => scope.trim()).filter(Boolean);
        if (normalizedScopes.length === 0)
            return res.status(400).json({ ok: false, message: "Requested scopes are not allowed." });

        if (normalizedScopes.length !== new Set(normalizedScopes).size)
            return res.status(400).json({ ok: false, message: "Duplicate scopes are not allowed." });

        const grant = await database.serviceGrant.upsert({
            where: {
                serviceClientId_userId: {
                    serviceClientId: client.id,
                    userId: authContext.user.id
                }
            },
            update: {
                scopes: normalizedScopes,
                revokedAt: null
            },
            create: {
                serviceClientId: client.id,
                userId: authContext.user.id,
                scopes: normalizedScopes
            }
        });

        const code = generateOAuthCode(
            authContext.user.id,
            client.clientId,
            normalizedScopes,
            redirectUri,
            AUTH_CODE_TTL_SECONDS
        );

        const redirectUrl = buildRedirectUrl(redirectUri, {
            code,
            state: parsed.data.state
        });

        return res.status(200).json({ ok: true, data: { redirectUrl, grantId: grant.id, authorizationCode: code } });
    }

    return res.status(405).json({ ok: false, message: "Method not allowed." });
}
