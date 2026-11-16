import buildInfo from "@/generated/build-info.json";

/**
 * Options shared by every runtime Sentry runs in. DSNs are public by design, so the production one is
 * baked in - `NEXT_PUBLIC_SENTRY_DSN` only needs setting to point a build somewhere else.
 */
export const SENTRY_OPTIONS = {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "https://cd8c5882d02607f7a94f81b818dc6ac5@o40609.ingest.us.sentry.io/4512397969457152",
    enabled: process.env.NODE_ENV === "production",
    environment: process.env.NODE_ENV,
    release: buildInfo.commitId === "unknown" ? undefined : buildInfo.commitId,
    tracesSampleRate: 0,
};
