// Everything the server reads from the environment at import time. Imported before anything from `src`.

const TEST_ENV: Record<string, string> = {
    NODE_ENV: "test",
    BASE_URL: "https://api.lapse.test",
    WEB_BASE_URL: "https://lapse.test",
    S3_ENCRYPTED_BUCKET_NAME: "encrypted",
    S3_PUBLIC_BUCKET_NAME: "public",
    S3_ENDPOINT: "https://s3.lapse.test",
    S3_ACCESS_KEY_ID: "test",
    S3_SECRET_ACCESS_KEY: "test",
    S3_PUBLIC_URL_ENCRYPTED: "https://encrypted.lapse.test",
    S3_PUBLIC_URL_PUBLIC: "https://public.lapse.test",
    PRIVATE_KEY_UPLOAD_KEY: "00".repeat(32),
    HACKATIME_CLIENT_ID: "hackatime-client",
    HACKATIME_URL: "https://hackatime.test",
    JWT_SECRET_ACCESS_TOKENS: "test-access-token-secret",
    JWT_CONSENT_TOKENS: "test-consent-token-secret",
    JWT_UPLOAD_TOKEN: "test-upload-token-secret",
    LOOKOUT_API_BASE_URL: "https://lookout.test",
    LOOKOUT_API_KEY: "lookout-key",
    SLACK_BOT_TOKEN: "slack-token",
    REDIS_URL: "redis://redis.lapse.test:6379",
    DATABASE_URL: "postgresql://postgres.lapse.test/lapse",
    DEFAULT_PFP_URL: "https://lapse.test/pfp.png",
    CONSENT_URL: "https://lapse.test/oauth/authorize",
    CANONICAL_OAUTH_CLIENT_ID: "svc_canonical",
    CANONICAL_OAUTH_CLIENT_NAME: "Lapse",
    CANONICAL_OAUTH_CLIENT_DESCRIPTION: "The Lapse website",
    CANONICAL_OAUTH_CLIENT_HOMEPAGE_URL: "https://lapse.test",
    CANONICAL_OAUTH_CLIENT_REDIRECT_URIS: "https://lapse.test/auth",
    SESSION_COOKIES: "on",
};

for (const [name, value] of Object.entries(TEST_ENV))
    process.env[name] = value;

export const CANONICAL_CLIENT_ID = TEST_ENV["CANONICAL_OAUTH_CLIENT_ID"]!;
