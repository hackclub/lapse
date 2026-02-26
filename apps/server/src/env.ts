/**
 * All known environment variables.
 */
export const env = {
    /**
     * The base URL the API is hosted on.
     */
    get BASE_URL() { return required("BASE_URL") },

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
     * The Hackatime OAuth client ID for authentication.
     */
    get HACKATIME_CLIENT_ID() { return required("NEXT_PUBLIC_HACKATIME_CLIENT_ID") },

    /**
     * The Hackatime server URL for OAuth.
     */
    get HACKATIME_URL() { return required("NEXT_PUBLIC_HACKATIME_URL") },

    /**
     * The secret key used for JWT token generation and verification.
     */
    // Generate one using [openssl rand -hex 32]!
    get JWT_SECRET() { return required("JWT_SECRET") },

    /**
     * The secret key used for creating JWT tokens for OAuth2 access codes.
     */
    // Generate one using [openssl rand -hex 32]!
    get JWT_SECRET_ACCESS_TOKENS() { return required("JWT_SECRET_ACCESS_TOKENS") },

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
    get SENTRY_PROJECT() { return required("SENTRY_PROJECT") },

    /**
     * A fallback Hackatime API key used in development when OAuth is unavailable.
     * Only considered when `NODE_ENV` is not `"production"`.
     */
    get DEV_HACKATIME_FALLBACK_KEY() { return optional("DEV_HACKATIME_FALLBACK_KEY") },

    /**
     * The Slack bot token used to fetch user profile information.
     */
    get SLACK_BOT_TOKEN() { return required("SLACK_BOT_TOKEN") },

    /**
     * The Slack API URL.
     */
    get SLACK_API_URL() { return optional("SLACK_API_URL") || "https://slack.com/api" },

    /**
     * The URL for the Redis database, used for job management via BullMQ.
     */
    get REDIS_URL() { return required("REDIS_URL") },

    /**
     * The port the HTTP web-server will listen on.
     */
    get PORT() { return optional("PORT") ?? "3123" },

    /**
     * The URL to the PostgreSQL database to use for Prisma.
     */
    get DATABASE_URL() { return required("DATABASE_URL") },

    /**
     * A permanent public URL to the image asset to use as the default profile picture placeholder.
     */
    get DEFAULT_PFP_URL() { return required("DEFAULT_PFP_URL") },

    /**
     * The ID of the canonical OAuth client, which will be allowed to handle consent screens, request the `elevated` scope, and bypass
     * consent modals when authorizing. In production, this is the main `lapse.hackclub.com` client.
     */
    get CANONICAL_OAUTH_CLIENT_ID() { return required("CANONICAL_OAUTH_CLIENT_ID") }
};

function required(name: string) {
    if (process.env[name] === undefined)
        throw new Error(`Environment variable ${name} not defined.`);

    return process.env[name];
}

function optional(name: string) {
    return process.env[name];
}
