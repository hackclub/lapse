import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { getRestAuthContext } from "@/server/auth";
import { database } from "@/server/db";
import { rotateServiceClientSecret } from "@/server/services/serviceClientService";

const ParamSchema = z.object({
    id: z.string()
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const authContext = await getRestAuthContext(req);
    if (!authContext.user)
        return res.status(401).json({ ok: false, message: "Authentication required." });

    if (req.method !== "POST")
        return res.status(405).json({ ok: false, message: "Method not allowed." });

    const params = ParamSchema.safeParse(req.query);
    if (!params.success)
        return res.status(400).json({ ok: false, message: "Missing app id." });

    const app = await database.serviceClient.findFirst({
        where: { id: params.data.id, createdByUserId: authContext.user.id, revokedAt: null }
    });

    if (!app)
        return res.status(404).json({ ok: false, message: "App not found." });

    const { clientSecret } = await rotateServiceClientSecret(app.id);
    return res.status(200).json({ ok: true, data: { clientSecret } });
}
