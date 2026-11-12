import { S3Client } from "@aws-sdk/client-s3";

import { env } from "@/env.js";

/**
 * Client for `S3_PUBLIC_BUCKET_NAME`, the only bucket the worker writes to.
 */
export const publicS3 = new S3Client({
    region: "auto",
    endpoint: env.S3_PUBLIC_ENDPOINT,
    credentials: {
        accessKeyId: env.S3_PUBLIC_ACCESS_KEY_ID,
        secretAccessKey: env.S3_PUBLIC_SECRET_ACCESS_KEY,
    },
});
