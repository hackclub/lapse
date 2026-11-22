/**
 * DSNs are public by design, so the production one is baked in - `NEXT_PUBLIC_SENTRY_DSN` only needs setting to
 * point a build somewhere else. Kept free of imports so `next.config.ts` can read it too.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "https://cd8c5882d02607f7a94f81b818dc6ac5@o40609.ingest.us.sentry.io/4512397969457152";

/**
 * Sentry's endpoint for CSP violation reports, derived from the DSN.
 */
export function sentrySecurityReportUrl(dsn: string): string | null {
    try {
        const url = new URL(dsn);
        const projectId = url.pathname.replace(/^\//, "");
        if (!url.username || !projectId)
            return null;

        return `${url.protocol}//${url.host}/api/${projectId}/security/?sentry_key=${url.username}`;
    }
    catch {
        return null;
    }
}
