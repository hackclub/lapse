import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { database } from "@/server/db";
import { getRestAuthContext } from "@/server/auth";

const RevokeSchema = z.object({
    grantId: z.string()
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const authContext = await getRestAuthContext(req);
    if (!authContext.user)
        return res.status(401).json({ ok: false, message: "Authentication required." });

    if (req.method === "GET") {
        const grants = await database.serviceGrant.findMany({
            where: { userId: authContext.user.id, revokedAt: null },
            include: { serviceClient: true },
            orderBy: { updatedAt: "desc" }
        });

        return res.status(200).json({
            ok: true,
            data: {
                grants: grants.map(grant => ({
                    id: grant.id,
                    serviceClientId: grant.serviceClientId,
                    serviceName: grant.serviceClient.name,
                    scopes: grant.scopes,
                    createdAt: grant.createdAt.toISOString(),
                    lastUsedAt: grant.lastUsedAt ? grant.lastUsedAt.toISOString() : null
                }))
            }
        });
    }

    if (req.method === "DELETE") {
        const parsed = RevokeSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ ok: false, message: "Invalid revoke request." });

        const grant = await database.serviceGrant.findFirst({
            where: { id: parsed.data.grantId, userId: authContext.user.id }
        });

        if (!grant)
            return res.status(404).json({ ok: false, message: "Grant not found." });

        await database.serviceGrant.update({
            where: { id: grant.id },
            data: { revokedAt: new Date() }
        });

        return res.status(200).json({ ok: true, data: {} });
    }

    return res.status(405).json({ ok: false, message: "Method not allowed." });
}
