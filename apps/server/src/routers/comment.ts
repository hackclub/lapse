import { z } from "zod";
import { implement } from "@orpc/server";
import { commentRouterContract, type Comment } from "@hackclub/lapse-api";

import * as db from "@/generated/prisma/client.js";

import { logMiddleware, type Context } from "@/router.js";
import { authorize } from "@/policies.js";
import { dtoPublicUser } from "@/routers/user.js";
import { getTimelapseById } from "@/routers/timelapse.js";
import { apiErr, apiOk, Err } from "@/common.js";
import { database } from "@/db.js";
import { adminOverrideActorId, recordAdminDeletion } from "@/adminAudit.js";
import type * as safe from "@/secrets.js";

const os = implement(commentRouterContract)
    .$context<Context>()
    .use(logMiddleware);

/**
 * Represents a `Comment` ORM entity with all of its associated fields.
 */
export type DbComment = db.Comment & { author: safe.User };

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
        .use(authorize("comment.create"))
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapse = await getTimelapseById(req.input.id, req.context.actor);
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
        .use(authorize("comment.delete"))
        .handler(async (req) => {
            const comment = await database().comment.findUnique({
                where: { id: req.input.commentId }
            });

            if (!comment)
                return apiErr("NOT_FOUND", "Comment not found.");

            await database().comment.delete({
                where: { id: req.input.commentId }
            });

            const adminId = adminOverrideActorId(req.context.actor, comment.authorId);
            if (adminId !== null) {
                await recordAdminDeletion(adminId, "comment", comment.id);
            }

            return apiOk({});
        })
});
