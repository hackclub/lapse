import z from "zod";

import { apiResult, LapseDate, LapseId } from "@/common";
import { PublicUserSchema } from "@/contracts/user";
import { contract, NO_OUTPUT } from "@/internal";

export type Comment = z.infer<typeof CommentSchema>;
export const CommentSchema = z.object({
    /**
     * The ID of the comment.
     */
    id: LapseId,

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
    createdAt: LapseDate
});

export const commentRouterContract = {
    create: contract("POST", "/comment/create")
        .route({ description: "Creates a new comment for the given timelapse." })
        .input(
            z.object({
                id: LapseId
                    .describe("The ID of the timelapse this comment should be created for."),

                content: z.string().min(1).max(280)
                    .describe("The content of the comment. This can contain a limited subset of Markdown (bold, italic, strikethrough, code).")
            })
        )
        .output(
            apiResult({
                comment: CommentSchema
            })
        ),

    delete: contract("DELETE", "/comment/delete")
        .route({ description: "Deletes a comment owned by the calling user." })
        .input(
            z.object({
                commentId: LapseId
                    .describe("The ID of the comment to delete.")
            })
        )
        .output(NO_OUTPUT)
};
