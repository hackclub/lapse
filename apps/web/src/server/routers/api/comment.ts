import "../../allow-only-server";

import { z } from "zod";

import { PrismaClient } from "../../../generated/prisma";
import { router, protectedProcedure } from "../../trpc";
import { apiResult, apiErr, apiOk, Err } from "../../../shared/common";
import { dtoPublicUser, PublicUserSchema } from "./user";
import * as db from "../../../generated/prisma";
import { logRequest } from "../../serverCommon";
import { ApiDate, PublicId } from "../common";
import { getTimelapseById } from "@/server/routers/api/timelapse";

const database = new PrismaClient();

export type Comment = z.infer<typeof CommentSchema>;
export const CommentSchema = z.object({
    /**
     * The ID of the comment.
     */
    id: PublicId,

    /**
     * The content of the comment. This can contain a limited subset of Markdown (bold, italic, strikethrough, code). 
     */
    content: z.string(),

    /**
     * The user that created this comment.
     */
    author: PublicUserSchema,

    /**
     * The date when the comment was created.
     */
    createdAt: ApiDate,
});

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

export default router({
    /**
     * Creates a new comment for the given timelapse.
     */
    create: protectedProcedure()
        .input(
            z.object({
                /**
                 * The ID of the timelapse this comment should be created for.
                 */
                id: PublicId,

                /**
                 * The content of the comment. This can contain a limited subset of Markdown (bold, italic, strikethrough, code).
                 */
                content: z.string().min(1).max(280)
            })
        )
        .output(
            apiResult({
                comment: CommentSchema
            })
        )
        .mutation(async (req) => {
            logRequest("comment/create", req);

            const timelapse = await getTimelapseById(req.input.id, req.ctx.user);
            if (timelapse instanceof Err)
                return timelapse.toApiError();

            if (!timelapse.isPublished)
                return apiErr("ERROR", "Cannot post comments on unpublished timelapses.");

            const comment = await database.comment.create({
                data: {
                    authorId: req.ctx.user.id,
                    timelapseId: req.input.id,
                    content: req.input.content
                },
                include: { author: true }
            });

            return apiOk({ comment: dtoComment(comment) });
        })
});
