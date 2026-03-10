/**
 * All known environment variables.
 */
export const env = {
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
     * The URL for the Redis database, used for job management via BullMQ.
     */
    get REDIS_URL() { return required("REDIS_URL") },

    /**
     * Passed to `Sentry.init`.
     */
    get SENTRY_DSN() { return optional("SENTRY_DSN") }
};

function optional(name: string) {
    return process.env[name];
}

function required(name: string) {
    if (process.env[name] === undefined)
        throw new Error(`Environment variable ${name} not defined.`);

    return process.env[name];
}

