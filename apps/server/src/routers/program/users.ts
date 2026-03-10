import { implement } from "@orpc/server";
import { programRouterContract } from "@hackclub/lapse-api";

import { type ProgramKeyContext, programLogMiddleware, requiredProgramKey, requiredProgramScopes } from "@/router.js";
import { apiErr, apiOk } from "@/common.js";
import { database } from "@/db.js";

const os = implement(programRouterContract)
    .$context<ProgramKeyContext>()
    .use(programLogMiddleware);

export const listUsers = os.listUsers
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const where = req.input.cursor
            ? { id: { lt: req.input.cursor } }
            : {};

        const users = await database().user.findMany({
            where,
            orderBy: { id: "desc" },
            take: req.input.limit + 1
        });

        const hasMore = users.length > req.input.limit;
        if (hasMore) users.pop();

        return apiOk({
            users: users.map(u => ({
                id: u.id,
                createdAt: u.createdAt.getTime(),
                handle: u.handle,
                displayName: u.displayName,
                profilePictureUrl: u.profilePictureUrl,
                bio: u.bio,
                urls: u.urls,
                hackatimeId: u.hackatimeId,
                slackId: u.slackId,
                email: u.email,
                permissionLevel: u.permissionLevel,
                lastHeartbeat: u.lastHeartbeat.getTime()
            })),
            nextCursor: hasMore ? users[users.length - 1].id : null
        });
    });

export const getUser = os.getUser
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const user = await database().user.findFirst({
            where: { id: req.input.id }
        });

        if (!user)
            return apiOk({ user: null });

        return apiOk({
            user: {
                id: user.id,
                createdAt: user.createdAt.getTime(),
                handle: user.handle,
                displayName: user.displayName,
                profilePictureUrl: user.profilePictureUrl,
                bio: user.bio,
                urls: user.urls,
                hackatimeId: user.hackatimeId,
                slackId: user.slackId,
                email: user.email,
                permissionLevel: user.permissionLevel,
                lastHeartbeat: user.lastHeartbeat.getTime()
            }
        });
    });
