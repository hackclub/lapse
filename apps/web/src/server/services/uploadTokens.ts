import "@/server/allow-only-server";

import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { env } from "@/server/env";
import { database } from "@/server/db";
import { logInfo, logError, logWarning } from "@/server/serverCommon";
import { UPLOAD_TOKEN_LIFETIME_MS } from "@/shared/constants";

import type { Prisma, UploadToken } from "@/generated/prisma/client";
import { Err, Result } from "@/shared/common";

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.S3_ENDPOINT}`,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

type PrismaClientOrTx = typeof database | Prisma.TransactionClient;

function defaultExpiry(): Date {
    return new Date(Date.now() + UPLOAD_TOKEN_LIFETIME_MS);
}

export type CreateUploadTokenParams = {
    ownerId: string;
    bucket: string;
    key: string;
    mimeType: string;
    maxSize: number;
    expiresAt?: Date;
};

/**
 * Creates an upload token that authorizes a client to upload a file to S3
 * via the `/api/upload` endpoint.
 */
export async function createUploadToken(prisma: PrismaClientOrTx, params: CreateUploadTokenParams): Promise<UploadToken> {
    const expires = params.expiresAt ?? defaultExpiry();

    return prisma.uploadToken.create({
        data: {
            bucket: params.bucket,
            key: params.key,
            mimeType: params.mimeType,
            ownerId: params.ownerId,
            maxSize: params.maxSize,
            expires,
        },
    });
}

/**
 * Marks an upload token as uploaded after the client has successfully
 * uploaded the file to S3.
 * 
 * This is idempotent - calling it on an already-uploaded token returns success.
 */
export async function markUploadTokenUploaded(
    prisma: PrismaClientOrTx,
    params: { tokenId: string; ownerId: string }
): Promise<Result<UploadToken>> {
    const token = await prisma.uploadToken.findFirst({
        where: { id: params.tokenId, ownerId: params.ownerId },
    });

    if (!token)
        return new Err("NOT_FOUND", `The upload token with ID ${params.tokenId} couldn't be found.`);
    
    if (token.expires < new Date())
        return new Err("EXPIRED", `The upload token expired on ${token.expires.toUTCString()} (it is currently ${new Date().toUTCString()}).`);
    
    if (token.uploaded)
        return token;

    const updated = await prisma.uploadToken.update({
        where: { id: token.id },
        data: { uploaded: true },
    });

    return updated;
}

/**
 * Consumes upload tokens by their IDs, removing them from a database.
 * **A missed call to this function can cause data associated with a token to be disposed of.**
 * 
 * This should be used when consuming tokens after their associated resources
 * have been committed (e.g., after creating a Timelapse from a draft).
 */
export async function consumeUploadTokens(prisma: PrismaClientOrTx, tokenIds: string[]): Promise<void> {
    await prisma.uploadToken.deleteMany({
        where: { id: { in: tokenIds } },
    });
}
/**
 * Retrieves an upload token for validation purposes (e.g., in /api/upload).
 * Does not modify the token.
 */
export async function getUploadTokenForUpload(
    prisma: PrismaClientOrTx,
    params: { tokenId: string; ownerId: string }
): Promise<UploadToken | null> {
    return prisma.uploadToken.findFirst({
        where: { id: params.tokenId, ownerId: params.ownerId },
    });
}

/**
 * Verifies that the resource represented by the upload token hasn't been used in any non-ephemeral database record.
 * Returns `true` if the token is unused.
 */
export async function isUploadTokenUnused(prisma: PrismaClientOrTx, token: UploadToken) {
    const timelapseUsage = await prisma.timelapse.findFirst({
        select: { id: true },
        where: {
            // If this token points to the public bucket, we want published timelapses - otherwise, unpublished ones. 
            isPublished: token.bucket == env.S3_PUBLIC_BUCKET_NAME,

            // We can use S3 objects for either thumbnails or videos - check for both
            OR: [
                { s3Key: token.key },
                { thumbnailS3Key: token.key }
            ]
        }
    });

    if (timelapseUsage) {
        logWarning("upload", `usage check for token ${token.id} failed - used in timelapse ${timelapseUsage.id}!`);
        return false;
    }

    return true;
}

/**
 * If the token hasn't been used by any other resource, deletes it, potentially wiping the data
 * associated with it.
 */
export async function wipeUploadToken(prisma: PrismaClientOrTx, token: UploadToken) {
    if (token.uploaded) {
        // This token has data associated with it. We have to be careful here.
        if (!await isUploadTokenUnused(prisma, token)) {
            logWarning("upload", `aborting wipe of upload token ${token.id}`);
            return;
        }

        // No resource looks to be using the data associated with said upload token - go ahead and delete it.
        // This is still relatively dangerous!
        await s3.send(new DeleteObjectCommand({
            Bucket: token.bucket,
            Key: token.key,
        }));
    }

    await prisma.uploadToken.delete({
        where: { id: token.id },
    });
}