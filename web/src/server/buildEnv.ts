import "./allow-only-server";
import { requiredEnv } from "@hackclub/lapse-common";

// The following values need to be defined as environment variables.
// They will only be accessed during build-time.

/**
 * The organization name for Sentry monitoring.
 */
export const SENTRY_ORG = requiredEnv("SENTRY_ORG");

/**
 * The name of the Sentry project.
 */
export const SENTRY_PROJECT = requiredEnv("SENTRY_PROJECT");
