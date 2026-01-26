import type { NextApiRequest, NextApiResponse } from "next";

import { database } from "@/server/db";
import { getRestAuthContext } from "@/server/auth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const authContext = await getRestAuthContext(req);
  if (!authContext.user)
    return res
      .status(401)
      .json({ ok: false, message: "Authentication required." });

  if (authContext.user.permissionLevel === "USER")
    return res
      .status(403)
      .json({ ok: false, message: "Admin access required." });

  if (req.method === "GET") {
    const apps = await database.serviceClient.findMany({
      orderBy: { createdAt: "desc" },
      include: { createdByUser: true },
    });

    return res.status(200).json({
      ok: true,
      data: {
        apps: apps.map((app) => ({
          id: app.id,
          name: app.name,
          description: app.description,
          homepageUrl: app.homepageUrl,
          iconUrl: app.iconUrl,
          clientId: app.clientId,
          scopes: app.scopes,
          redirectUris: app.redirectUris,
          trustLevel: app.trustLevel,
          createdBy: {
            id: app.createdByUser.id,
            handle: app.createdByUser.handle,
            displayName: app.createdByUser.displayName,
          },
          createdAt: app.createdAt.toISOString(),
        })),
      },
    });
  }

  return res.status(405).json({ ok: false, message: "Method not allowed." });
}
