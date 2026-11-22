import buildInfo from "@/generated/build-info.json";
import { SENTRY_DSN } from "@/sentryDsn";

/**
 * Options shared by every runtime Sentry runs in.
 */
export const SENTRY_OPTIONS = {
    dsn: SENTRY_DSN,
    enabled: process.env.NODE_ENV === "production",
    environment: process.env.NODE_ENV,
    release: buildInfo.commitId === "unknown" ? undefined : buildInfo.commitId,
    tracesSampleRate: 0,
};
