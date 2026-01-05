import { vi } from "vitest";

export const mockEnv = {
    S3_ENDPOINT: "test-endpoint.s3.amazonaws.com",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
    S3_ENCRYPTED_BUCKET_NAME: "test-encrypted-bucket",
    S3_PUBLIC_BUCKET_NAME: "test-public-bucket",
    S3_PUBLIC_URL_ENCRYPTED: "https://encrypted.example.com",
    S3_PUBLIC_URL_PUBLIC: "https://public.example.com",
    PRIVATE_KEY_UPLOAD_KEY: "0123456789abcdef0123456789abcdef",
    SLACK_CLIENT_ID: "test-slack-client-id",
    SLACK_CLIENT_SECRET: "test-slack-client-secret",
    SLACK_REDIRECT_URI: "http://localhost:3000/api/auth/slack/callback",
    JWT_SECRET: "test-jwt-secret-key-that-is-long-enough",
    // Used by `timelapse.syncWithHackatime` in production.
    HACKATIME_ADMIN_KEY: "hka_test-hackatime-admin-key",

    // Used by `timelapse.syncWithHackatime` in non-production.
    // Must NOT start with `hka_` (that prefix indicates an admin key).
    DEV_HACKATIME_FALLBACK_KEY: "test_user_hackatime_key",

    // Legacy/unused in current server code; kept for compatibility.
    HACKATIME_API_KEY: "test-hackatime-api-key",
};

export function setupEnvMock(): void {
    vi.mock("@/server/env", () => ({
        env: mockEnv,
    }));
}
