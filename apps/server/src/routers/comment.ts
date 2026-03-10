import { z } from "zod";
import { implement } from "@orpc/server";
import { commentRouterContract, type Comment } from "@hackclub/lapse-api";

import * as db from "@/generated/prisma/client.js";

import { logMiddleware, requiredAuth, requiredScopes, type Context } from "@/router.js";
import { dtoPublicUser } from "@/routers/user.js";
import { getTimelapseById } from "@/routers/timelapse.js";
import { apiErr, apiOk, Err } from "@/common.js";
import { database } from "@/db.js";

const os = implement(commentRouterContract)
    .$context<Context>()
    .use(logMiddleware);

/**
 * Represents a `Comment` ORM entity with all of its associated fields.
 */
export type DbComment = db.Comment & { author: db.User };

/**
 * Converts a database representation of a comment to a runtime (API) one.
 */
export function dtoComment(comment: DbComment): Comment {
    return {
        id: comment.id,
        content: comment.content,
        author: dtoPublicUser(comment.author),
        createdAt: comment.createdAt.getTime()
    };
}

export default os.router({
    create: os.create
        .use(requiredAuth())
        .use(requiredScopes("comment:write"))
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapse = await getTimelapseById(req.input.id, caller);
            if (timelapse instanceof Err)
                return timelapse.toApiError();
            
            const comment = await database().comment.create({
                data: {
                    authorId: caller.id,
                    timelapseId: req.input.id,
                    content: req.input.content
                },
                include: { author: true }
            });

            return apiOk({ comment: dtoComment(comment) });
        }),

    delete: os.delete
        .use(requiredAuth())
        .use(requiredScopes("comment:write"))
        .handler(async (req) => {
            const caller = req.context.user;

            const comment = await database().comment.findUnique({
                where: { id: req.input.commentId }
            });

            if (!comment)
                return apiErr("NOT_FOUND", "Comment not found.");

            if (comment.authorId !== caller.id)
                return apiErr("NO_PERMISSION", "You can only delete your own comments.");

            await database().comment.delete({
                where: { id: req.input.commentId }
            });

            return apiOk({});
        })
});
