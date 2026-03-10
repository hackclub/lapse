import { implement } from "@orpc/server";
import { programRouterContract, type ProgramUser } from "@hackclub/lapse-api";

import * as db from "@/generated/prisma/client.js";
import { type ProgramKeyContext, programLogMiddleware, requiredProgramKey, requiredProgramScopes } from "@/router.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";

const os = implement(programRouterContract)
    .$context<ProgramKeyContext>()
    .use(programLogMiddleware);

/**
 * Converts a database representation of a user to a Program API DTO.
 */
export function dtoProgramUser(entity: db.User): ProgramUser {
    return {
        id: entity.id,
        createdAt: entity.createdAt.getTime(),
        handle: entity.handle,
        displayName: entity.displayName,
        profilePictureUrl: entity.profilePictureUrl,
        bio: entity.bio,
        urls: entity.urls,
        hackatimeId: entity.hackatimeId,
        slackId: entity.slackId,
        email: entity.email,
        permissionLevel: entity.permissionLevel,
        lastHeartbeat: entity.lastHeartbeat.getTime(),
    };
}

export const listUsers = os.listUsers
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const limit = req.input.limit;

        const users = await database().user.findMany({
            orderBy: { id: "desc" },
            take: limit + 1,
            ...(req.input.cursor
                ? { cursor: { id: req.input.cursor }, skip: 1 }
                : {}),
        });

        const hasMore = users.length > limit;
        if (hasMore) {
            users.pop();
        }

        const nextCursor = hasMore ? users[users.length - 1].id : null;

        return apiOk({
            users: users.map(dtoProgramUser),
            nextCursor,
        });
    });

export const getUser = os.getUser
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const user = await database().user.findFirst({
            where: { id: req.input.id },
        });

        if (!user)
            return apiOk({ user: null });

        return apiOk({
            user: dtoProgramUser(user),
        });
    });
