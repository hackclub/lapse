import { implement } from "@orpc/server";
import { programRouterContract } from "@hackclub/lapse-api";

import { type ProgramKeyContext, programLogMiddleware, requiredProgramKey, requiredProgramScopes } from "@/router.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";

const os = implement(programRouterContract)
    .$context<ProgramKeyContext>()
    .use(programLogMiddleware);

export const stats = os.stats
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async () => {
        const [totalUsers, totalTimelapses, totalComments, durationAgg] = await Promise.all([
            database().user.count(),
            database().timelapse.count(),
            database().comment.count(),
            database().timelapse.aggregate({ _sum: { duration: true } })
        ]);

        return apiOk({
            totalUsers,
            totalTimelapses,
            totalComments,
            totalLoggedSeconds: durationAgg._sum.duration ?? 0
        });
    });

export const listClients = os.listClients
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async () => {
        const clients = await database().serviceClient.findMany({
            orderBy: { createdAt: "desc" }
        });

        return apiOk({
            clients: clients.map(c => ({
                id: c.id,
                clientId: c.clientId,
                name: c.name,
                description: c.description,
                homepageUrl: c.homepageUrl,
                scopes: c.scopes,
                trustLevel: c.trustLevel,
                createdAt: c.createdAt.toISOString(),
                revokedAt: c.revokedAt?.toISOString() ?? null
            }))
        });
    });
