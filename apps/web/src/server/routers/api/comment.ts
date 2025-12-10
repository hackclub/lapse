import "@/server/allow-only-server";

import { z } from "zod";

import { apiResult, apiErr, apiOk, Err } from "@/shared/common";

import { router, protectedProcedure } from "@/server/trpc";
import { dtoPublicUser, PublicUserSchema } from "@/server/routers/api/user";
import { logRequest } from "@/server/serverCommon";
import { ApiDate, PublicId } from "@/server/routers/common";
import { getTimelapseById } from "@/server/routers/api/timelapse";

import * as db from "@/generated/prisma";

const database = new db.PrismaClient();

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
        }),

    /**
     * Deletes a comment. Only the author of the comment can delete it.
     */
    delete: protectedProcedure()
        .input(
            z.object({
                /**
                 * The ID of the comment to delete.
                 */
                commentId: PublicId
            })
        )
        .output(
            apiResult({
                success: z.boolean()
            })
        )
        .mutation(async (req) => {
            logRequest("comment/delete", req);

            // Find the comment
            const comment = await database.comment.findUnique({
                where: { id: req.input.commentId }
            });

            if (!comment)
                return apiErr("NOT_FOUND", "Comment not found.");

            // Check if the user is the author
            if (comment.authorId !== req.ctx.user.id)
                return apiErr("NO_PERMISSION", "You can only delete your own comments.");

            // Delete the comment
            await database.comment.delete({
                where: { id: req.input.commentId }
            });

            return apiOk({ success: true });
        })
});
