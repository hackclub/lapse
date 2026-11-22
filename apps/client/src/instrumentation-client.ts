import * as Sentry from "@sentry/nextjs";

import { SENTRY_OPTIONS } from "@/sentry";

Sentry.init({
    ...SENTRY_OPTIONS,
    ignoreErrors: [
        // Thrown by browsers when a ResizeObserver callback takes longer than a frame. Harmless and unactionable.
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications",
        // A `play()` promise rejects when the video is paused or unmounted before playback starts - e.g. Lookout's
        // editor (`void v.play()`) closing mid-load as the user moves on to publish. Nothing was lost.
        /The play\(\) request was interrupted/,
    ],
    // Errors thrown from browser extensions' own scripts (e.g. ones that wrap `fetch`). The Next.js SDK rewrites
    // every origin to `app://` afterwards, so these show up in Sentry as bare paths like `app:///executors/200.js`.
    denyUrls: [
        /^(chrome|moz|safari-web|ms-browser)-extension:\/\//i,
        /^extension:\/\//i,
        // A content-blocking extension that wraps `window.fetch` and leaves its own promise chain unhandled, so a
        // request it blocks surfaces as an unhandled "Failed to fetch" even when our caller catches the error.
        /\/activeContentBlocker\.js/,
        // Vercel Speed Insights, served from a hashed first-party path (`/687c2cd54b5a9aef/script.js`). Crawler fleets
        // that mangle its response throw a `SyntaxError` at 1:1 for every page they hit.
        /\/_vercel\/(speed-)?insights\//,
        /^(https?|app):\/\/[^/]*\/[0-9a-f]{16}\/script\.js/,
    ],
    beforeSend(event) {
        // Anti-detect browsers (seen from crawler fleets) inject a `noisify` wrapper around canvas reads to spoof
        // fingerprints. It calls `getImageData` on canvases we only `toDataURL`, which throws for zero-sized ones.
        const frames = event.exception?.values?.flatMap(value => value.stacktrace?.frames ?? []) ?? [];
        if (frames.some(frame => frame.function === "noisify" || frame.function === "noisifyWrapper"))
            return null;

        // A browser extension's `fetch` wrapper (`injectScriptAdjust.js`) re-raises failures on a promise of its own
        // that nothing awaits, so fetches we already catch (e.g. the editor's R2 preview download) arrive as
        // unhandled rejections.
        if (frames.some(frame => frame.filename?.endsWith("/injectScriptAdjust.js")))
            return null;

        // Google Translate swaps React's text nodes for `<font>` wrappers, so React's next commit fails to find them
        // (facebook/react#11538). It marks the page it has translated with a class on `<html>`.
        const translated = document.documentElement.classList.contains("translated-ltr") ||
            document.documentElement.classList.contains("translated-rtl");

        const domMismatch = event.exception?.values?.some(value =>
            value.type === "NotFoundError" && /Failed to execute '(insertBefore|removeChild)' on 'Node'/.test(value.value ?? "")
        );

        if (translated && domMismatch)
            return null;

        return event;
    },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
