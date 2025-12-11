import "@/server/allow-only-server";

/**
 * All known environment variables.
 */
export const env = {
    /**
     * The S3 name for the bucket that stores encrypted (private) user content.
     */
    get S3_ENCRYPTED_BUCKET_NAME() { return required("S3_ENCRYPTED_BUCKET_NAME") },

    /**
     * The S3 name for the bucket that stores publicly accessible user content.
     */
    get S3_PUBLIC_BUCKET_NAME() { return required("S3_PUBLIC_BUCKET_NAME") },

    /**
     * The S3 API endpoint domain, without the protocol prefix.
     */
    get S3_ENDPOINT() { return required("S3_ENDPOINT") },

    /**
     * The "Access Key ID" associated with the token that will be used to access Lapse S3 buckets.
     */
    get S3_ACCESS_KEY_ID() { return required("S3_ACCESS_KEY_ID") },

    /**
     * The "Secret Access Key" associated with the token that will be used to access Lapse S3 buckets.
     */
    get S3_SECRET_ACCESS_KEY() { return required("S3_SECRET_ACCESS_KEY") },

    /**
     * The public URL for the `S3_ENCRYPTED_BUCKET_NAME` bucket. Will be suffixed with object names. The URL does *not* include a trailing slash.
     */
    get S3_PUBLIC_URL_ENCRYPTED() { return required("S3_PUBLIC_URL_ENCRYPTED") },

    /**
     * The public URL for the `S3_PUBLIC_BUCKET_NAME` bucket. Will be suffixed with object names. The URL does *not* include a trailing slash.
     */
    get S3_PUBLIC_URL_PUBLIC() { return required("S3_PUBLIC_URL_PUBLIC") },

    /**
     * The private key used to encrypt S3 bucket keys. Should be a 32-character hex string.
     */
    // Generate one using [openssl rand -hex 16]!
    get PRIVATE_KEY_UPLOAD_KEY() { return required("PRIVATE_KEY_UPLOAD_KEY") },

    /**
     * The Slack OAuth client ID for authentication.
     */
    get SLACK_CLIENT_ID() { return required("NEXT_PUBLIC_SLACK_CLIENT_ID") },

    /**
     * The Slack OAuth client secret for authentication.
     */
    get SLACK_CLIENT_SECRET() { return required("SLACK_CLIENT_SECRET") },

    /**
     * The secret key used for JWT token generation and verification.
     */
    // Generate one using [openssl rand -hex 32]!
    get JWT_SECRET() { return required("JWT_SECRET") },

    /**
     * The 32-byte secret key used to generate encrypted upload tokens, represented as a 64 character hex string.
     */
    // Generate one using [openssl rand -hex 32]!
    get UPLOAD_TOKEN_PRIVATE_KEY() { return required("UPLOAD_TOKEN_PRIVATE_KEY") },

    /**
     * The 16-byte IV used to generate encrypted upload tokens, represented as a 32 character hex string.
     */
    // Generate one using [openssl rand -hex 16]!
    get UPLOAD_TOKEN_IV() { return required("UPLOAD_TOKEN_IV") },

    /**
     * Passed to `Sentry.init`.
     */
    get SENTRY_DSN() { return required("NEXT_PUBLIC_SENTRY_DSN") },

    /**
     * The organization name for Sentry monitoring.
     */
    get SENTRY_ORG() { return required("SENTRY_ORG") },

    /**
     * The name of the Sentry project.
     */
    get SENTRY_PROJECT() { return required("SENTRY_PROJECT") }
};

function required(name: string) {
    if (process.env[name] === undefined)
        throw new Error(`Environment variable ${name} not defined.`);

    return process.env[name];
}
