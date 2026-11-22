import { randomInt } from "node:crypto";
import type { BrowserWarningVariant } from "@hackclub/lapse-api";

import type * as db from "@/generated/prisma/client.js";

import { database } from "@/db.js";
import { isHackatimeRestricted } from "@/routers/hackatime.js";

/**
 * A/B test of whether asking "are you sure?" before a Browser recording, and recommending the Lookout desktop app,
 * moves people to the desktop app. Outcomes are read from `Timelapse.recordedWith` and the `mode` on `created` draft
 * events, for users with an `ExperimentAssignment` row. Set `BROWSER_WARNING_TEST_ACTIVE` to `false` to end it.
 *
 * Replaces the `browser-label` test (five ways of labelling the Browser option), whose rows are kept for reference.
 */
export const BROWSER_WARNING_EXPERIMENT = "browser-warning";
export const BROWSER_WARNING_TEST_ACTIVE = true;

const BROWSER_WARNING_VARIANTS: readonly BrowserWarningVariant[] = ["none", "warning"];

function isBrowserWarningVariant(value: string): value is BrowserWarningVariant {
    return (BROWSER_WARNING_VARIANTS as readonly string[]).includes(value);
}

/**
 * Returns the user's variant, assigning one at random the first time. Users who can't record in the browser at all
 * are left out, since the warning can't change what they do.
 */
export async function assignBrowserWarningVariant(user: db.User): Promise<BrowserWarningVariant | null> {
    if (!BROWSER_WARNING_TEST_ACTIVE)
        return null;

    const key = { userId_experiment: { userId: user.id, experiment: BROWSER_WARNING_EXPERIMENT } };

    const existing = await database().experimentAssignment.findUnique({ where: key });
    if (existing)
        return isBrowserWarningVariant(existing.variant) ? existing.variant : null;

    if (await isHackatimeRestricted(user))
        return null;

    // An upsert, so two tabs racing on the first assignment agree on whichever variant landed first.
    const assignment = await database().experimentAssignment.upsert({
        where: key,
        create: {
            userId: user.id,
            experiment: BROWSER_WARNING_EXPERIMENT,
            variant: BROWSER_WARNING_VARIANTS[randomInt(BROWSER_WARNING_VARIANTS.length)],
        },
        update: {},
    });

    return isBrowserWarningVariant(assignment.variant) ? assignment.variant : null;
}
