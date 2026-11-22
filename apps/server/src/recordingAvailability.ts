import z from "zod";

import type * as db from "@/generated/prisma/client.js";

import { cachedJson } from "@/cache.js";
import { env } from "@/env.js";
import { logWarning } from "@/logging.js";

export const BROWSER_RECORDING_MAINTENANCE_MESSAGE = "Browser recording is currently under maintenance. Please use the Lookout desktop app instead.";

const AvailabilityResponseSchema = z.object({
    browserRecording: z.boolean(),
});

const AVAILABILITY_TTL_SECONDS = 2 * 60;
const AVAILABILITY_TIMEOUT_MS = 3_000;

/**
 * Whether the user may use the Browser (screen) recording mode. Camera mode is unaffected. Off for everyone while
 * `BROWSER_RECORDING_MAINTENANCE` is set; otherwise `RECORDING_AVAILABILITY_URL`, if configured, decides per user.
 *
 * That service receives `POST { userId, hackatimeId, slackId }` with `Authorization: Bearer <secret>` and answers
 * `{ browserRecording: boolean }`. If it can't be reached, recording stays available - an outage there shouldn't
 * take recording down with it.
 */
export async function isBrowserRecordingAvailable(user: db.User): Promise<boolean> {
    if (env.BROWSER_RECORDING_MAINTENANCE)
        return false;

    const url = env.RECORDING_AVAILABILITY_URL;
    if (!url)
        return true;

    try {
        return await cachedJson(
            `lapse:recording_availability:${user.id}`,
            AVAILABILITY_TTL_SECONDS,
            async () => await askAvailabilityService(url, user)
        );
    }
    catch (err) {
        logWarning("Couldn't check recording availability; allowing browser recording.", { err, userId: user.id });
        return true;
    }
}

async function askAvailabilityService(url: string, user: db.User): Promise<boolean> {
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(env.RECORDING_AVAILABILITY_SECRET ? { Authorization: `Bearer ${env.RECORDING_AVAILABILITY_SECRET}` } : {}),
        },
        body: JSON.stringify({
            userId: user.id,
            hackatimeId: user.hackatimeId,
            slackId: user.slackId,
        }),
        signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
    });

    if (!res.ok)
        throw new Error(`Recording availability service responded with HTTP ${res.status}`);

    return AvailabilityResponseSchema.parse(await res.json()).browserRecording;
}
