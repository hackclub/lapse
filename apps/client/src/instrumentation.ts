import * as Sentry from "@sentry/nextjs";

import { SENTRY_OPTIONS } from "@/sentry";

export function register() {
    Sentry.init(SENTRY_OPTIONS);
}

export const onRequestError = Sentry.captureRequestError;
