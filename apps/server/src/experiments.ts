import { randomInt } from "node:crypto";
import type { BrowserLabelVariant } from "@hackclub/lapse-api";

import type * as db from "@/generated/prisma/client.js";

import { database } from "@/db.js";
import { isHackatimeRestricted } from "@/routers/hackatime.js";

/**
 * A/B test of whether and how the Browser option in the recording mode picker is labelled (see `BrowserLabelVariant`), to see whether the label moves people
 * to the Lookout desktop app. Outcomes are read from `Timelapse.recordedWith` and the `mode` on `created` draft
 * events, for users with an `ExperimentAssignment` row. Set `BROWSER_LABEL_TEST_ACTIVE` to `false` to end it.
 */
export const BROWSER_LABEL_EXPERIMENT = "browser-label";
export const BROWSER_LABEL_TEST_ACTIVE = true;

const BROWSER_LABEL_VARIANTS: readonly BrowserLabelVariant[] = ["none", "badge-less-stable", "badge-legacy", "text-less-stable", "text-legacy"];

function isBrowserLabelVariant(value: string): value is BrowserLabelVariant {
    return (BROWSER_LABEL_VARIANTS as readonly string[]).includes(value);
}

/**
 * Returns the user's variant, assigning one at random the first time. Users who can't record in the browser at all
 * are left out, since the label can't change what they do.
 */
export async function assignBrowserLabelVariant(user: db.User): Promise<BrowserLabelVariant | null> {
    if (!BROWSER_LABEL_TEST_ACTIVE)
        return null;

    const existing = await database().experimentAssignment.findUnique({
        where: { userId_experiment: { userId: user.id, experiment: BROWSER_LABEL_EXPERIMENT } },
    });

    if (existing)
        return isBrowserLabelVariant(existing.variant) ? existing.variant : null;

    if (await isHackatimeRestricted(user))
        return null;

    // An upsert, so two tabs racing on the first assignment agree on whichever variant landed first.
    const assignment = await database().experimentAssignment.upsert({
        where: { userId_experiment: { userId: user.id, experiment: BROWSER_LABEL_EXPERIMENT } },
        create: {
            userId: user.id,
            experiment: BROWSER_LABEL_EXPERIMENT,
            variant: BROWSER_LABEL_VARIANTS[randomInt(BROWSER_LABEL_VARIANTS.length)],
        },
        update: {},
    });

    return isBrowserLabelVariant(assignment.variant) ? assignment.variant : null;
}
