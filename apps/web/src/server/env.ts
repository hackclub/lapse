import "./allow-only-server";

function createEnv<T extends Record<string, string>>(keys: T): { [K in keyof T]: string } {
    return new Proxy({} as { [K in keyof T]: string }, {
        get(_, key: string) {
            const envKey = keys[key];
            if (!envKey)
                throw new Error(`Unknown environment variable: ${key}`);

            const value = process.env[envKey];
            if (value)
                return value;
            
            throw new Error(`The environment variable ${envKey} is missing.`);
        }
    });
}

export const env = createEnv({
    // The S3 name for the bucket that stores encrypted (private) user content.
    S3_ENCRYPTED_BUCKET_NAME: "S3_ENCRYPTED_BUCKET_NAME",

    // The S3 name for the bucket that stores publicly accessible user content.
    S3_PUBLIC_BUCKET_NAME: "S3_PUBLIC_BUCKET_NAME",

    // The S3 name for the bucket that stores private data related to tracing.
    S3_TRACING_BUCKET_NAME: "S3_TRACING_BUCKET_NAME",

    // The private key used to encrypt S3 bucket keys.
    PRIVATE_KEY_UPLOAD_KEY: "PRIVATE_KEY_UPLOAD_KEY",

    // The S3 API endpoint domain, without the protocol prefix.
    S3_ENDPOINT: "S3_ENDPOINT",

    // The "Access Key ID" associated with the token that will be used to access Lapse S3 buckets.
    S3_ACCESS_KEY_ID: "S3_ACCESS_KEY_ID",

    // The "Secret Access Key" associated with the token that will be used to access Lapse S3 buckets.
    S3_SECRET_ACCESS_KEY: "S3_SECRET_ACCESS_KEY",

    // The public URL for the `S3_ENCRYPTED_BUCKET_NAME` bucket. Will be suffixed with object names.
    S3_PUBLIC_URL_ENCRYPTED: "S3_PUBLIC_URL_ENCRYPTED",

    // The public URL for the `S3_PUBLIC_BUCKET_NAME` bucket. Will be suffixed with object names.
    S3_PUBLIC_URL_PUBLIC: "S3_PUBLIC_URL_PUBLIC",

    // The Slack OAuth client ID for authentication.
    SLACK_CLIENT_ID: "NEXT_PUBLIC_SLACK_CLIENT_ID",

    // The Slack OAuth client secret for authentication.
    SLACK_CLIENT_SECRET: "SLACK_CLIENT_SECRET",

    // The secret key used for JWT token generation and verification.
    JWT_SECRET: "JWT_SECRET",

    // The 32-byte secret key used to generate encrypted upload tokens, represented as a 64 character hex string.
    UPLOAD_TOKEN_PRIVATE_KEY: "UPLOAD_TOKEN_PRIVATE_KEY",

    // The 16-byte IV used to generate encrypted upload tokens, represented as a 32 character hex string.
    UPLOAD_TOKEN_IV: "UPLOAD_TOKEN_IV",

    // Passed to `Sentry.init`.
    SENTRY_DSN: "NEXT_PUBLIC_SENTRY_DSN",

    // The organization name for Sentry monitoring.
    SENTRY_ORG: "SENTRY_ORG",

    // The name of the Sentry project.
    SENTRY_PROJECT: "SENTRY_PROJECT",
});
