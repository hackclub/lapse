import * as Sentry from "@sentry/node";

import { env } from "@/env.js";

// Imported before anything else in `app.ts`, so Sentry is watching from the first line that can throw.
if (env.SENTRY_DSN) {
    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: process.env["NODE_ENV"] ?? "development",
        release: env.SOURCE_COMMIT,
        tracesSampleRate: 0,
    });
}
