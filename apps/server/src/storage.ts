import { S3Client } from "@aws-sdk/client-s3";

import { env } from "@/env.js";

export type Bucket = "encrypted" | "public";

/**
 * Client for `S3_ENCRYPTED_BUCKET_NAME`.
 */
export const encryptedS3 = new S3Client({
    region: "auto",
    endpoint: env.S3_ENDPOINT,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

/**
 * Client for `S3_PUBLIC_BUCKET_NAME`. The public bucket can live on a different account than the encrypted one, so
 * it has its own endpoint and token, which fall back to the shared ones when unset.
 */
export const publicS3 = new S3Client({
    region: "auto",
    endpoint: env.S3_PUBLIC_ENDPOINT,
    credentials: {
        accessKeyId: env.S3_PUBLIC_ACCESS_KEY_ID,
        secretAccessKey: env.S3_PUBLIC_SECRET_ACCESS_KEY,
    },
});

export function s3For(bucket: Bucket) {
    return bucket === "encrypted" ? encryptedS3 : publicS3;
}

export function bucketName(bucket: Bucket) {
    return bucket === "encrypted" ? env.S3_ENCRYPTED_BUCKET_NAME : env.S3_PUBLIC_BUCKET_NAME;
}
