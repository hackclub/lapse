import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import * as fs from "fs";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import prettyBytes from "pretty-bytes";

import { env } from "@/server/env";
import { logError, logInfo, logNextRequest } from "@/server/serverCommon";
import { ApiResult, apiErr, Empty, apiOk } from "@/shared/common";
import { getAuthenticatedUser } from "@/server/auth";

import * as db from "@/generated/prisma/client";

// POST /api/upload
//    Consumes an upload token, and starts uploading a file to the S3 bucket associated with the
//    given upload token. This endpoint accepts multipart form inputs, with two fields:
///   tokenId and file.
//
//    This endpoint is separate from all of the other tRPC endpoints because of the unfortunate fact
//    that JSON isn't really good at transporting large bits of data.
//
//    The flow for uploading a file looks something like this:
//  
//              user gets a upload token via e.g. timelapse.createDraft
//                                      |
//                  /api/upload gets called with the token
//                                      |
//                 token gets used up via e.g. timelapse.create
//
//    ...where /api/upload does the job of transferring the file onto S3. In an ideal world,
//    we'd do everything from one singular endpoint. But we don't live in an ideal world... :(
//    And we definitely do not want to force API consumers to use FormData for every API surface.
//
//    An upload token represents a transitional state anywhere in the diagram above. Expired
//    upload tokens should have all S3 data associated with them removed.

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.S3_ENDPOINT}`,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
});

export const config = {
    api: {
        // we're handling multipart data manually
        bodyParser: false,
    },
};

import { database } from "@/server/db";

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse<ApiResult<Empty>>
) {
    logNextRequest("upload", req);

    if (req.method !== "POST")
        return res.status(405).json(apiErr("ERROR", "Method not allowed - try POST-ing instead."));

    const user = await getAuthenticatedUser(req);
    if (!user)
        return res.status(401).json(apiErr("NO_PERMISSION", "This endpoint requires authentication."));

    // We only wipe stale tokens on production. We can tolerate those on development, and we DON'T want a scenario where someone
    // is developing on production S3 buckets.
    if (process.env.NODE_ENV === "production") {
        // TODO: This would probably be better with a cronjob instead...
        const staleTokens = await database.uploadToken.findMany({
            where: { expires: { lt: new Date() } },
            include: { owner: true }
        });

        for (const token of staleTokens) {
            logInfo("upload", `removing stale upload token ${token.id} owned by @${token.owner.handle}`, { token });

            if (token.uploaded) {
                s3.send(new DeleteObjectCommand({
                    Bucket: token.bucket,
                    Key: token.key
                }));
            }

            await database.uploadToken.delete({
                where: { id: token.id }
            });
        }
    }
    

    try {
        const form = formidable({
            maxFileSize: 200 * 1024 * 1024, // 200MB max (higher than our limits to let token validation handle it)
            keepExtensions: true,
            allowEmptyFiles: false,
            maxFiles: 1
        });

        const [fields, files] = await form.parse(req);

        const tokenId = Array.isArray(fields.token) ? fields.token[0] : fields.token;
        const file = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!tokenId)
            return res.status(400).json(apiErr("MISSING_PARAMS", "Upload token hasn't been provided. You might be missing a 'token' field in your form data."));

        if (!file)
            return res.status(400).json(apiErr("MISSING_PARAMS", "File hasn't been provided. Make sure to include at least one file in your form data."));

        const token = await database.uploadToken.findFirst({
            where: { id: tokenId, ownerId: user.id }
        });

        if (!token)
            return res.status(400).json(apiErr("ERROR", "Upload token is invalid."));

        if (token.expires < new Date())
            return res.status(401).json(apiErr("ERROR", "Upload token is expired."));

        if (token.uploaded)
            return res.status(409).json(apiErr("ALREADY_PUBLISHED", "This upload token has already been used."));

        if (file.size > token.maxSize)
            return res.status(413).json(apiErr("SIZE_LIMIT", `File size ${file.size} bytes exceeds limit of ${token.maxSize} bytes.`));

        if (file.mimetype && file.mimetype !== token.mimeType)
            return res.status(400).json(apiErr("ERROR", `Invalid content type; expected ${token.mimeType}, got ${file.mimetype}.`));

        logInfo("upload", `uploading ${token.mimeType} of size ${prettyBytes(file.size)} to ${token.bucket}/${token.key}`, { token });

        await s3.send(new PutObjectCommand({
            Bucket: token.bucket,
            Key: token.key,
            Body: fs.createReadStream(file.filepath),
            ContentType: token.mimeType
        }));

        logInfo("upload", `file ${token.bucket}/${token.key} uploaded!`, { token });

        await database.uploadToken.update({
            where: { id: token.id },
            data: { uploaded: true }
        });

        return res.status(200).json(apiOk({}));
    }
    catch (error) {
        logError("upload", "Failed to upload file!", { error });
        return res.status(500).json(apiErr("ERROR", "An internal server error occured while uploading file"));
    }
}
