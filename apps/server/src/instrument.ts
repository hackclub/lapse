import * as Sentry from "@sentry/node";

import { env } from "@/env.js";

const PANEL_TOKEN = /\/lookout\/panel\/[^/?#"\s]+/g;

/**
 * A Lookout panel's URL is its credential - whoever has it can answer the panel for that recording - so it must not
 * reach Sentry through a request URL attached to an error.
 */
function scrubPanelTokens<T>(value: T): T {
    const json = JSON.stringify(value);
    if (json === undefined)
        return value;

    const scrubbed = json.replace(PANEL_TOKEN, "/lookout/panel/[token]");
    return scrubbed === json ? value : JSON.parse(scrubbed) as T;
}

// Imported before anything else in `app.ts`, so Sentry is watching from the first line that can throw.
if (env.SENTRY_DSN) {
    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: process.env["NODE_ENV"] ?? "development",
        release: env.SOURCE_COMMIT,
        tracesSampleRate: 0,
        beforeSend: scrubPanelTokens,
        beforeBreadcrumb: scrubPanelTokens,
    });
}
