import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { database } from "@/server/db";
import { getRestAuthContext } from "@/server/auth";

const ParamSchema = z.object({
    id: z.string()
});

const UpdateSchema = z.object({
    trustLevel: z.enum(["UNTRUSTED", "TRUSTED"]),
    notes: z.string().optional()
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const authContext = await getRestAuthContext(req);
    if (!authContext.user)
        return res.status(401).json({ ok: false, message: "Authentication required." });

    if (authContext.user.permissionLevel === "USER")
        return res.status(403).json({ ok: false, message: "Admin access required." });

    const params = ParamSchema.safeParse(req.query);
    if (!params.success)
        return res.status(400).json({ ok: false, message: "Missing app id." });

    if (req.method !== "PATCH")
        return res.status(405).json({ ok: false, message: "Method not allowed." });

    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, message: "Invalid update payload." });

    const app = await database.serviceClient.findFirst({
        where: { id: params.data.id, revokedAt: null }
    });

    if (!app)
        return res.status(404).json({ ok: false, message: "App not found." });

    const updated = await database.serviceClient.update({
        where: { id: app.id },
        data: { trustLevel: parsed.data.trustLevel }
    });

    await database.serviceClientReview.create({
        data: {
            serviceClientId: app.id,
            reviewedByUserId: authContext.user.id,
            status: parsed.data.trustLevel,
            notes: parsed.data.notes ?? ""
        }
    });

    return res.status(200).json({
        ok: true,
        data: {
            trustLevel: updated.trustLevel
        }
    });
}
