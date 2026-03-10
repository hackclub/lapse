import { implement } from "@orpc/server";
import { programRouterContract, type ProgramTimelapse, type ProgramComment } from "@hackclub/lapse-api";

import * as db from "@/generated/prisma/client.js";
import { type ProgramKeyContext, programLogMiddleware, requiredProgramKey, requiredProgramScopes } from "@/router.js";
import { apiOk } from "@/common.js";
import { database } from "@/db.js";

type DbTimelapse = db.Timelapse & { owner: db.User, _count: { comments: number } };
type DbComment = db.Comment & { author: db.User };

const os = implement(programRouterContract)
    .$context<ProgramKeyContext>()
    .use(programLogMiddleware);

/**
 * Converts a database representation of a timelapse to a Program API DTO.
 */
export function dtoProgramTimelapse(entity: DbTimelapse): ProgramTimelapse {
    return {
        id: entity.id,
        name: entity.name,
        description: entity.description,
        visibility: entity.visibility,
        duration: entity.duration,
        createdAt: entity.createdAt.getTime(),
        ownerId: entity.ownerId,
        ownerHandle: entity.owner.handle,
        hackatimeProject: entity.hackatimeProject,
        commentCount: entity._count.comments,
    };
}

/**
 * Converts a database representation of a comment to a Program API DTO.
 */
export function dtoProgramComment(entity: DbComment): ProgramComment {
    return {
        id: entity.id,
        content: entity.content,
        createdAt: entity.createdAt.getTime(),
        authorId: entity.authorId,
        authorHandle: entity.author.handle,
        timelapseId: entity.timelapseId,
    };
}

export const listTimelapses = os.listTimelapses
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const limit = req.input.limit;

        const timelapses = await database().timelapse.findMany({
            include: { owner: true, _count: { select: { comments: true } } },
            orderBy: { id: "desc" },
            take: limit + 1,
            ...(req.input.cursor
                ? { cursor: { id: req.input.cursor }, skip: 1 }
                : {}),
        });

        const hasMore = timelapses.length > limit;
        if (hasMore) {
            timelapses.pop();
        }

        const nextCursor = hasMore ? timelapses[timelapses.length - 1].id : null;

        return apiOk({
            timelapses: timelapses.map(dtoProgramTimelapse),
            nextCursor,
        });
    });

export const getTimelapse = os.getTimelapse
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const timelapse = await database().timelapse.findFirst({
            where: { id: req.input.id },
            include: { owner: true, _count: { select: { comments: true } } },
        });

        if (!timelapse)
            return apiOk({ timelapse: null });

        return apiOk({
            timelapse: dtoProgramTimelapse(timelapse),
        });
    });

export const listComments = os.listComments
    .use(requiredProgramKey())
    .use(requiredProgramScopes("program:read"))
    .handler(async (req) => {
        const limit = req.input.limit;

        const comments = await database().comment.findMany({
            include: { author: true },
            orderBy: { id: "desc" },
            take: limit + 1,
            ...(req.input.cursor
                ? { cursor: { id: req.input.cursor }, skip: 1 }
                : {}),
        });

        const hasMore = comments.length > limit;
        if (hasMore) {
            comments.pop();
        }

        const nextCursor = hasMore ? comments[comments.length - 1].id : null;

        return apiOk({
            comments: comments.map(dtoProgramComment),
            nextCursor,
        });
    });
