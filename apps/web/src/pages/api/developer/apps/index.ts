import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { database } from "@/server/db";
import { getRestAuthContext } from "@/server/auth";
import { getAllOAuthScopes } from "@/shared/oauthScopes";
import {
    createServiceClient,
    normalizeRedirectUris,
    normalizeScopes
} from "@/server/services/serviceClientService";

const CreateSchema = z.object({
    name: z.string().min(2).max(48),
    description: z.string().max(200).default(""),
    homepageUrl: z.string().url(),
    iconUrl: z.string().url().optional(),
    redirectUris: z.array(z.string().url()).min(1),
    scopes: z.array(z.string()).min(1)
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const authContext = await getRestAuthContext(req);
    if (!authContext.user)
        return res.status(401).json({ ok: false, message: "Authentication required." });

    if (req.method === "GET") {
        const apps = await database.serviceClient.findMany({
            where: { createdByUserId: authContext.user.id, revokedAt: null },
            orderBy: { createdAt: "desc" }
        });

        return res.status(200).json({
            ok: true,
            data: {
                apps: apps.map(app => ({
                    id: app.id,
                    name: app.name,
                    description: app.description,
                    homepageUrl: app.homepageUrl,
                    iconUrl: app.iconUrl,
                    clientId: app.clientId,
                    scopes: app.scopes,
                    redirectUris: app.redirectUris,
                    trustLevel: app.trustLevel
                }))
            }
        });
    }

    if (req.method === "POST") {
        const parsed = CreateSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ ok: false, message: "Invalid app payload." });

        const validScopes = new Set(getAllOAuthScopes());
        const requestedScopes = normalizeScopes(parsed.data.scopes);
        const invalidScopes = requestedScopes.filter(scope => !validScopes.has(scope));
        if (invalidScopes.length > 0)
            return res.status(400).json({ ok: false, message: `Unknown scopes: ${invalidScopes.join(", ")}` });

        const redirectUris = normalizeRedirectUris(parsed.data.redirectUris);
        const homepageHost = new URL(parsed.data.homepageUrl).hostname;
        const mismatchedRedirects = redirectUris.filter(uri => new URL(uri).hostname !== homepageHost);
        if (mismatchedRedirects.length > 0)
            return res.status(400).json({ ok: false, message: "Redirect URIs must match the homepage domain." });

        const { client, clientSecret } = await createServiceClient({
            name: parsed.data.name,
            description: parsed.data.description ?? "",
            homepageUrl: parsed.data.homepageUrl,
            iconUrl: parsed.data.iconUrl ?? "",
            redirectUris,
            scopes: requestedScopes,
            createdByUserId: authContext.user.id
        });

        return res.status(201).json({
            ok: true,
            data: {
                app: {
                    id: client.id,
                    name: client.name,
                    clientId: client.clientId,
                    scopes: client.scopes,
                    redirectUris: client.redirectUris,
                    trustLevel: client.trustLevel,
                    description: client.description,
                    homepageUrl: client.homepageUrl,
                    iconUrl: client.iconUrl
                },
                clientSecret
            }
        });
    }

    return res.status(405).json({ ok: false, message: "Method not allowed." });
}
