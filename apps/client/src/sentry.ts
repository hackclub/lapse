import buildInfo from "@/generated/build-info.json";
import { SENTRY_DSN } from "@/sentryDsn";

const PANEL_TOKEN = /\/lookout\/panel\/[^/?#"\s]+/g;

/**
 * A Lookout panel's URL is its credential - whoever has it can answer the panel for that recording - so it must not
 * reach Sentry through a page URL, a fetch breadcrumb or an error message.
 */
export function scrubPanelTokens<T>(value: T): T {
    const json = JSON.stringify(value);
    if (json === undefined)
        return value;

    const scrubbed = json.replace(PANEL_TOKEN, "/lookout/panel/[token]");
    return scrubbed === json ? value : JSON.parse(scrubbed) as T;
}

/**
 * Options shared by every runtime Sentry runs in.
 */
export const SENTRY_OPTIONS = {
    beforeSend: scrubPanelTokens,
    beforeBreadcrumb: scrubPanelTokens,
    dsn: SENTRY_DSN,
    enabled: process.env.NODE_ENV === "production",
    environment: process.env.NODE_ENV,
    release: buildInfo.commitId === "unknown" ? undefined : buildInfo.commitId,
    tracesSampleRate: 0,
};
