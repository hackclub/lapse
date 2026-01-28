import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { database } from "@/server/db";
import { getRestAuthContext } from "@/server/auth";
import { getAllOAuthScopes } from "@/shared/oauthScopes";
import {
    normalizeRedirectUris,
    normalizeScopes,
    rotateServiceClientSecret
} from "@/server/services/serviceClientService";

const UpdateSchema = z.object({
    name: z.string().min(2).max(48).optional(),
    description: z.string().max(200).optional(),
    homepageUrl: z.string().url().optional(),
    iconUrl: z.string().url().optional(),
    redirectUris: z.array(z.string().url()).optional(),
    scopes: z.array(z.string()).optional()
});

const ParamSchema = z.object({
    id: z.string()
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const authContext = await getRestAuthContext(req);
    if (!authContext.user)
        return res.status(401).json({ ok: false, message: "Authentication required." });

    const params = ParamSchema.safeParse(req.query);
    if (!params.success)
        return res.status(400).json({ ok: false, message: "Missing app id." });

    const app = await database.serviceClient.findFirst({
        where: { id: params.data.id, createdByUserId: authContext.user.id, revokedAt: null }
    });

    if (!app)
        return res.status(404).json({ ok: false, message: "App not found." });

    if (req.method === "PATCH") {
        const parsed = UpdateSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ ok: false, message: "Invalid update payload." });

        const updates: Record<string, unknown> = {
            ...parsed.data
        };

        if (parsed.data.scopes) {
            const validScopes = new Set(getAllOAuthScopes());
            const requestedScopes = normalizeScopes(parsed.data.scopes);
            const invalidScopes = requestedScopes.filter(scope => !validScopes.has(scope));
            if (invalidScopes.length > 0)
                return res.status(400).json({ ok: false, message: `Unknown scopes: ${invalidScopes.join(", ")}` });

            updates.scopes = requestedScopes;
        }

        if (parsed.data.redirectUris)
            updates.redirectUris = normalizeRedirectUris(parsed.data.redirectUris);

        if (updates.homepageUrl || updates.redirectUris) {
            const homepageUrl = (updates.homepageUrl as string | undefined) ?? app.homepageUrl;
            const redirectUris = (updates.redirectUris as string[] | undefined) ?? app.redirectUris;
            const homepageHost = new URL(homepageUrl).hostname;
            const mismatched = redirectUris.filter(uri => new URL(uri).hostname !== homepageHost);
            if (mismatched.length > 0)
                return res.status(400).json({ ok: false, message: "Redirect URIs must match the homepage domain." });
        }

        const updated = await database.serviceClient.update({
            where: { id: app.id },
            data: updates
        });

        return res.status(200).json({
            ok: true,
            data: {
                app: {
                    id: updated.id,
                    name: updated.name,
                    description: updated.description,
                    homepageUrl: updated.homepageUrl,
                    iconUrl: updated.iconUrl,
                    clientId: updated.clientId,
                    scopes: updated.scopes,
                    redirectUris: updated.redirectUris,
                    trustLevel: updated.trustLevel
                }
            }
        });
    }

    if (req.method === "DELETE") {
        await database.serviceClient.update({
            where: { id: app.id },
            data: { revokedAt: new Date() }
        });

        return res.status(200).json({ ok: true, data: {} });
    }

    return res.status(405).json({ ok: false, message: "Method not allowed." });
}
