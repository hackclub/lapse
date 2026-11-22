import { randomInt } from "node:crypto";
import type { BrowserLabelVariant, BrowserWarningVariant } from "@hackclub/lapse-api";

import type * as db from "@/generated/prisma/client.js";

import { database } from "@/db.js";
import { isHackatimeRestricted } from "@/routers/hackatime.js";

/**
 * Two A/B tests on the recording mode picker, run side by side and assigned independently, to see what moves people
 * from the Browser option to the Lookout desktop app:
 *
 * - `browser-label`: whether and how the Browser option is labelled (see `BrowserLabelVariant`).
 * - `browser-warning`: whether starting a Browser recording first asks "are you sure?" and recommends the desktop app.
 *
 * Outcomes are read from `Timelapse.recordedWith` and the `mode` on `created` draft events, for users with an
 * `ExperimentAssignment` row. Set a test's `*_TEST_ACTIVE` to `false` to end it.
 */
export const BROWSER_LABEL_EXPERIMENT = "browser-label";
export const BROWSER_LABEL_TEST_ACTIVE = true;
const BROWSER_LABEL_VARIANTS: readonly BrowserLabelVariant[] = ["none", "badge-less-stable", "badge-legacy", "text-less-stable", "text-legacy"];

export const BROWSER_WARNING_EXPERIMENT = "browser-warning";
export const BROWSER_WARNING_TEST_ACTIVE = true;
const BROWSER_WARNING_VARIANTS: readonly BrowserWarningVariant[] = ["none", "warning"];

/**
 * Returns the user's variant, assigning one at random the first time. Users who can't record in the browser at all
 * are left out, since neither test can change what they do.
 */
async function assignVariant<T extends string>(user: db.User, experiment: string, variants: readonly T[]): Promise<T | null> {
    const isVariant = (value: string): value is T => (variants as readonly string[]).includes(value);
    const key = { userId_experiment: { userId: user.id, experiment } };

    const existing = await database().experimentAssignment.findUnique({ where: key });
    if (existing)
        return isVariant(existing.variant) ? existing.variant : null;

    if (await isHackatimeRestricted(user))
        return null;

    // An upsert, so two tabs racing on the first assignment agree on whichever variant landed first.
    const assignment = await database().experimentAssignment.upsert({
        where: key,
        create: { userId: user.id, experiment, variant: variants[randomInt(variants.length)] },
        update: {},
    });

    return isVariant(assignment.variant) ? assignment.variant : null;
}

export async function assignBrowserLabelVariant(user: db.User): Promise<BrowserLabelVariant | null> {
    if (!BROWSER_LABEL_TEST_ACTIVE)
        return null;

    return await assignVariant(user, BROWSER_LABEL_EXPERIMENT, BROWSER_LABEL_VARIANTS);
}

export async function assignBrowserWarningVariant(user: db.User): Promise<BrowserWarningVariant | null> {
    if (!BROWSER_WARNING_TEST_ACTIVE)
        return null;

    return await assignVariant(user, BROWSER_WARNING_EXPERIMENT, BROWSER_WARNING_VARIANTS);
}
