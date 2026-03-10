import { implement } from "@orpc/server";
import { programRouterContract } from "@hackclub/lapse-api";

import { type ProgramKeyContext, programLogMiddleware, requiredProgramKey, requiredProgramScopes } from "@/router.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";

const os = implement(programRouterContract)
    .$context<ProgramKeyContext>()
    .use(programLogMiddleware);

export const listTimelapses = os.listTimelapses
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const where = req.input.cursor
            ? { id: { lt: req.input.cursor } }
            : {};

        const timelapses = await database().timelapse.findMany({
            where,
            orderBy: { id: "desc" },
            take: req.input.limit + 1,
            include: { owner: true, _count: { select: { comments: true } } }
        });

        const hasMore = timelapses.length > req.input.limit;
        if (hasMore) timelapses.pop();

        return apiOk({
            timelapses: timelapses.map(t => ({
                id: t.id,
                name: t.name,
                description: t.description,
                visibility: t.visibility,
                duration: t.duration,
                createdAt: t.createdAt.getTime(),
                ownerId: t.ownerId,
                ownerHandle: t.owner.handle,
                hackatimeProject: t.hackatimeProject,
                commentCount: t._count.comments
            })),
            nextCursor: hasMore ? timelapses[timelapses.length - 1].id : null
        });
    });

export const getTimelapse = os.getTimelapse
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const timelapse = await database().timelapse.findFirst({
            where: { id: req.input.id },
            include: { owner: true, _count: { select: { comments: true } } }
        });

        if (!timelapse)
            return apiOk({ timelapse: null });

        return apiOk({
            timelapse: {
                id: timelapse.id,
                name: timelapse.name,
                description: timelapse.description,
                visibility: timelapse.visibility,
                duration: timelapse.duration,
                createdAt: timelapse.createdAt.getTime(),
                ownerId: timelapse.ownerId,
                ownerHandle: timelapse.owner.handle,
                hackatimeProject: timelapse.hackatimeProject,
                commentCount: timelapse._count.comments
            }
        });
    });

export const listComments = os.listComments
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const where = req.input.cursor
            ? { id: { lt: req.input.cursor } }
            : {};

        const comments = await database().comment.findMany({
            where,
            orderBy: { id: "desc" },
            take: req.input.limit + 1,
            include: { author: true }
        });

        const hasMore = comments.length > req.input.limit;
        if (hasMore) comments.pop();

        return apiOk({
            comments: comments.map(c => ({
                id: c.id,
                content: c.content,
                createdAt: c.createdAt.getTime(),
                authorId: c.authorId,
                authorHandle: c.author.handle,
                timelapseId: c.timelapseId
            })),
            nextCursor: hasMore ? comments[comments.length - 1].id : null
        });
    });
