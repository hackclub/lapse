import "../../allow-only-server";

import { z } from "zod";
import { procedure, router, protectedProcedure } from "@/server/trpc";
import { apiResult, err, ok, oneOf } from "@/shared/common";
import * as db from "@/generated/prisma";
import { PublicId } from "@/server/routers/common";
import { logInfo, logRequest, logTracing } from "@/server/serverCommon";
import * as env from "@/server/env";
import { UPLOAD_TOKEN_LIFETIME_MS } from "@/shared/constants";

// These endpoints are used for internal statistics. All tracing is anonymized.
// Some of the endpoints in this router will be removed after the beta period ends.

const database = new db.PrismaClient();

export default router({
    /**
     * Provides the server with client-side information about a local video encoding job. 
     */
    traceEncodeStart: protectedProcedure()
        .input(
            z.object({
                /**
                 * All of the supported video codecs that can be used to encode the video.
                 */
                supportedCodecs: z.array(z.string()),

                /**
                 * The codec used to encode the video.
                 */
                usedCodec: z.string().nullable(),

                /**
                 * Statistics for all input chunks.
                 */
                inputs: z.array(z.object({
                    codec: z.string().nullable(),
                    codedWidth: z.number(),
                    codedHeight: z.number(),
                    displayWidth: z.number(),
                    displayHeight: z.number(),
                    duration: z.number()
                }).nullable())
            })
        )
        .output(apiResult({}))
        .query(async (req) => {
            logTracing("encodeStart", req.input);
            return ok({});
        }),

    /**
     * Creates upload tokens for raw unencrypted video chunks created on the client.
     */
    traceEncodingInputs: protectedProcedure()
        .input(
            z.object({
                /**
                 * The number of upload tokens to create. This is capped to 4.
                 */
                numUploads: z.number().min(1).max(4),

                /**
                 * The actual number of inputs that will be encoded.
                 */
                numInputs: z.number().min(1)
            })
        )
        .output(apiResult({
            uploads: z.array(z.string())
        }))
        .mutation(async (req) => {
            const uploads: string[] = [];
            const keys: string[] = [];
            const group = new Date().toISOString();

            for (let i = 0; i < req.input.numUploads; i++) {
                const key = `encoding-inputs/${group}/${i}-${group}.webm`;
                const token = await database.uploadToken.create({
                    data: {
                        key,
                        bucket: env.S3_TRACING_BUCKET_NAME,
                        expires: new Date(new Date().getTime() + UPLOAD_TOKEN_LIFETIME_MS),
                        maxSize: 2 * 1024 * 1024, // 2 MiB
                        mimeType: "video/webm",
                        ownerId: req.ctx.user.id
                    }
                });

                uploads.push(token.id);
                keys.push(key);
            }

            logTracing("encodingInputs", { keys, uploads })
            return ok({ uploads });
        })
});
