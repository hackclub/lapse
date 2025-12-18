import type { NextApiRequest, NextApiResponse } from "next";

import { logError } from "@/server/serverCommon";
import { database } from "@/server/db";

// GET /api/health
//     Returns an HTTP 200 response with "OK" if basic health checks have passed.
//     Otherwise, returns an HTTP 500 with an error code. Designed to be used with Coolify.

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    try {
        const firstUser = database.user.findFirst();
        if (!firstUser) {
            logError("health", "Health check failed - database not (properly) connected!", { req, database });
            res.status(500).send("NO_DATABASE");
            return;
        }

        return res.status(200).send("OK");
    }
    catch (error) {
        logError("health", "Health check failed!", { error, req, database });
        return res.status(500).send("ERROR");
    }
}
