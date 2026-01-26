import type { NextApiRequest, NextApiResponse } from "next";

import { buildRestOpenApiSpec } from "@/server/restOpenapi";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET")
        return res.status(405).json({ error: "invalid_request", error_description: "Method not allowed." });

    return res.status(200).json(buildRestOpenApiSpec());
}
