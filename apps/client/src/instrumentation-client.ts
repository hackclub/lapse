import * as Sentry from "@sentry/nextjs";

import { SENTRY_OPTIONS } from "@/sentry";

Sentry.init({
    ...SENTRY_OPTIONS,
    ignoreErrors: [
        // Thrown by browsers when a ResizeObserver callback takes longer than a frame. Harmless and unactionable.
        "ResizeObserver loop limit exceeded",
        "ResizeObserver loop completed with undelivered notifications",
    ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
