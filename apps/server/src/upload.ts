import z from "zod";
import * as tus from "@tus/server";
import { S3Store } from "@tus/s3-store"
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";

import { env } from "@/env.js";
import { logError } from "@/logging.js";
import { Err } from "@/common.js";

type UploadTokenJwt = z.infer<typeof UploadTokenJwtSchema>;
const UploadTokenJwtSchema = z.object({ 
    /**
     * The maximum size for this upload.
     */
    maxSize: z.number(),

    /**
     * The S3 key for this upload.
     */
    key: z.string()
});

function requireUploadToken(req: Request) {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer "))
        return new Err("NO_PERMISSION", "Unauthorized");

    let token: UploadTokenJwt
    try {
        token = UploadTokenJwtSchema.parse(
            jwt.verify(authHeader.substring("Bearer ".length), env.JWT_UPLOAD_TOKEN)
        );
    }
    catch (err) {
        logError(`Attempted to upload a file with an invalid upload token (${authHeader})`, { err });
        return new Err("NO_PERMISSION", "Invalid upload token");
    }

    return token;
}

/**
 * Issues an upload token that allows any user to upload data to the encrypted user data bucket through `tus` as `key`.
 */
export function issueUploadToken(key: string, maxSize: number) {
    return jwt.sign(
        { key, maxSize } satisfies UploadTokenJwt,
        env.JWT_UPLOAD_TOKEN,
        { expiresIn: "30m" }
    );
}

export function attachUploadServer(app: FastifyInstance) {
    const tusServer = new tus.Server({
        path: "/upload",
        datastore: new S3Store({
            // R2 requires that all non-trailing parts are exactly the same size. 
            partSize: 8 * 1024 * 1024,
            minPartSize: 8 * 1024 * 1024,
            s3ClientConfig: {
                bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                endpoint: env.S3_ENDPOINT,
                credentials: {
                    accessKeyId: env.S3_ACCESS_KEY_ID,
                    secretAccessKey: env.S3_SECRET_ACCESS_KEY
                }
            }
        }),

        async onIncomingRequest(req) {
            const token = requireUploadToken(req);
            if (token instanceof Err) {
                throw { status_code: 401, body: token.message };
            }
        },

        namingFunction(req) {
            const token = requireUploadToken(req);
            if (token instanceof Err) // this shouldn't really happen as we verify everything in onIncomingRequest
                throw new Error(token.message);

            return token.key;
        },

        async onUploadCreate(req, upload) {
            const token = requireUploadToken(req);
            if (token instanceof Err)
                throw { status_code: 401, body: token.message };

            if (!upload.size || upload.size > token.maxSize)
                throw { status_code: 413, body: `Upload size (${upload.size}) exceeds maximum size (${token.maxSize}).` };

            return {};
        }
    });

    app.addContentTypeParser("application/offset+octet-stream", (_request, _payload, done) => done(null));
    app.all("/upload", (req, res) => { tusServer.handle(req.raw, res.raw); });
    app.all("/upload/*", (req, res) => { tusServer.handle(req.raw, res.raw); });
}