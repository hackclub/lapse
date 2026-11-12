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
     * The S3 API endpoint for the `S3_PUBLIC_BUCKET_NAME` bucket, when it lives on a different account than the
     * encrypted one. Defaults to `S3_ENDPOINT`.
     */
    get S3_PUBLIC_ENDPOINT() { return optional("S3_PUBLIC_ENDPOINT") ?? required("S3_ENDPOINT") },

    /**
     * The "Access Key ID" for the `S3_PUBLIC_BUCKET_NAME` bucket. Defaults to `S3_ACCESS_KEY_ID`.
     */
    get S3_PUBLIC_ACCESS_KEY_ID() { return optional("S3_PUBLIC_ACCESS_KEY_ID") ?? required("S3_ACCESS_KEY_ID") },

    /**
     * The "Secret Access Key" for the `S3_PUBLIC_BUCKET_NAME` bucket. Defaults to `S3_SECRET_ACCESS_KEY`.
     */
    get S3_PUBLIC_SECRET_ACCESS_KEY() { return optional("S3_PUBLIC_SECRET_ACCESS_KEY") ?? required("S3_SECRET_ACCESS_KEY") },

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

