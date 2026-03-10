import { implement } from "@orpc/server";
import { programRouterContract, type ProgramServiceClient } from "@hackclub/lapse-api";

import * as db from "@/generated/prisma/client.js";
import { type ProgramKeyContext, programLogMiddleware, requiredProgramKey, requiredProgramScopes } from "@/router.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";

const os = implement(programRouterContract)
    .$context<ProgramKeyContext>()
    .use(programLogMiddleware);

/**
 * Converts a database representation of a service client to a Program API DTO.
 */
export function dtoProgramServiceClient(entity: db.ServiceClient): ProgramServiceClient {
    return {
        id: entity.id,
        clientId: entity.clientId,
        name: entity.name,
        description: entity.description,
        homepageUrl: entity.homepageUrl,
        scopes: entity.scopes,
        trustLevel: entity.trustLevel,
        createdAt: entity.createdAt.toISOString(),
        revokedAt: entity.revokedAt?.toISOString() ?? null,
    };
}

export const stats = os.stats
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async () => {
        const [totalUsers, totalTimelapses, totalComments, durationAgg] = await Promise.all([
            database().user.count(),
            database().timelapse.count(),
            database().comment.count(),
            database().timelapse.aggregate({ _sum: { duration: true } }),
        ]);

        return apiOk({
            totalUsers,
            totalTimelapses,
            totalComments,
            totalLoggedSeconds: durationAgg._sum.duration ?? 0,
        });
    });

export const listClients = os.listClients
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async () => {
        const clients = await database().serviceClient.findMany({
            orderBy: { createdAt: "desc" },
        });

        return apiOk({
            clients: clients.map(dtoProgramServiceClient),
        });
    });
