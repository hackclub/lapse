import type { NextApiRequest, NextApiResponse } from "next";

import * as db from "@/generated/prisma";
import { logError } from "@/server/serverCommon";

const database = new db.PrismaClient();

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    try {
        const firstUser = database.user.findFirst();
        if (!firstUser) {
            res.status(500).send("NO_DATABASE");
            return;
        }

        return res.status(200).send("OK");
    }
    catch (err) {
        logError("health", err);
        return res.status(500).send("ERROR");
    }
}
