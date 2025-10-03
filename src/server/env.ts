"use server";

function requiredEnv(key: string) {
    const value = process.env[key];
    if (value)
        return value;

    throw new Error(`The environment variable ${key} is missing.`);
}

// The following values need to defined as environment variables.

/**
 * The S3 name for the bucket that stores encrypted (private) user content.
 */
export const S3_ENCRYPTED_BUCKET_NAME = requiredEnv("S3_ENCRYPTED_BUCKET_NAME");

/**
 * The S3 name for the bucket that stores publicly accessible user content.
 */
export const S3_PUBLIC_BUCKET_NAME = requiredEnv("S3_PUBLIC_BUCKET_NAME");

/**
 * The private key used to encrypt S3 bucket keys.
 */
export const PRIVATE_KEY_UPLOAD_KEY = requiredEnv("PRIVATE_KEY_UPLOAD_KEY");

/**
 * The S3 API endpoint domain, without the protocol prefix.
 */
export const S3_ENDPOINT = requiredEnv("S3_ENDPOINT");

/**
 * The "Access Key ID" associated with the token that will be used to access Lapse S3 buckets. 
 */
export const S3_ACCESS_KEY_ID = requiredEnv("S3_ACCESS_KEY_ID");

/**
 * The "Secret Access Key" associated with the token that will be used to access Lapse S3 buckets.
 */
export const S3_SECRET_ACCESS_KEY = requiredEnv("S3_SECRET_ACCESS_KEY");

/**
 * The public URL for the `S3_ENCRYPTED_BUCKET_NAME` bucket. Will be suffixed with object names.
 */
export const S3_PUBLIC_URL_ENCRYPTED = requiredEnv("S3_PUBLIC_URL_ENCRYPTED");

/**
 * The public URL for the `S3_PUBLIC_BUCKET_NAME` bucket. Will be suffixed with object names.
 */
export const S3_PUBLIC_URL_PUBLIC = requiredEnv("S3_PUBLIC_URL_PUBLIC");

/**
 * The Slack OAuth client ID for authentication.
 */
export const SLACK_CLIENT_ID = requiredEnv("NEXT_PUBLIC_SLACK_CLIENT_ID");

/**
 * The Slack OAuth client secret for authentication.
 */
export const SLACK_CLIENT_SECRET = requiredEnv("SLACK_CLIENT_SECRET");

/**
 * The secret key used for JWT token generation and verification.
 */
export const JWT_SECRET = requiredEnv("JWT_SECRET");
