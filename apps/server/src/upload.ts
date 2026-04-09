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
        respectForwardedHeaders: true,
        datastore: new S3Store({
            // R2 requires that all non-trailing parts are exactly the same size. 
            partSize: 8 * 1024 * 1024,
            minPartSize: 8 * 1024 * 1024,
            s3ClientConfig: {
                bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                endpoint: env.S3_ENDPOINT,
                region: "auto",
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

        // The tus S3 store always uses the upload ID as the key. By default, tus generates a random one. As we have a defined S3 structure, we
        // *don't* want that, and thus we override our namingFunction.
        namingFunction(req) {
            const token = requireUploadToken(req);
            if (token instanceof Err) // this shouldn't really happen as we verify everything in onIncomingRequest
                throw new Error(token.message);

            return token.key;
        },

        // Now, as we put S3 keys as upload IDs, and those S3 keys are expected to have slashes in them, if we would put them out-right in the URL (which the default generateUrl implementation does),
        // we'd cause tus to report 404 errors when trying to find our uploads. Because of this, we encode the IDs as base64 in the URLs.
        generateUrl(req, { proto, host, path, id }) {
            return `${proto}://${host}${path}/${Buffer.from(id).toString("base64url")}`;
        },

        getFileIdFromRequest(req, lastPath) {
            if (!lastPath)
                return;

            return Buffer.from(lastPath, "base64url").toString("utf8");
        },

        async onUploadCreate(req, upload) {
            const token = requireUploadToken(req);
            if (token instanceof Err)
                throw { status_code: 401, body: token.message };

            // We tolerate an error margin of 1MiB.
            if (!upload.size || upload.size > (token.maxSize + (1024 * 1024)))
                throw { status_code: 413, body: `Upload size (${upload.size}) exceeds maximum size (${token.maxSize}).` };

            return {};
        },

        onResponseError(req, err) {
            logError(`tus: ${err instanceof Error ? err.message.trim() : `HTTP ${err.status_code}: ${err.body.trim()}`}`, { err, req });
            return undefined;
        }
    });

    app.addContentTypeParser("application/offset+octet-stream", (_request, _payload, done) => done(null));
    app.all("/upload", (req, res) => { tusServer.handle(req.raw, res.raw); });
    app.all("/upload/*", (req, res) => { tusServer.handle(req.raw, res.raw); });
}