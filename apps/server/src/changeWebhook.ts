import { createHmac } from "node:crypto";
import type { OwnedTimelapse } from "@hackclub/lapse-api";

import { database } from "@/db.js";
import { env } from "@/env.js";
import { logWarning } from "@/logging.js";
import { dtoOwnedTimelapse, TIMELAPSE_INCLUDES, TIMELAPSE_OMIT } from "@/routers/timelapse.js";

/**
 * Tells a subscribed service that a timelapse changed, so it doesn't have to wait for its next poll of
 * `timelapse.listChanged`. The feed is what a subscriber relies on; this only makes it quicker, so a
 * notification that can't be delivered is logged and dropped rather than retried until it gets through.
 *
 * The subscriber receives `POST { event, id, timelapse }` - `timelapse` being what `timelapse.listChanged` would return
 * for it, and left out for `timelapse.deleted` - with `x-lapse-signature: t=<unix seconds>,v1=<hex>`, where `v1` is
 * the HMAC-SHA256 of `<t>.<body>` keyed by the shared secret. Signing the time lets a subscriber turn away a request
 * replayed later (an old `updated` would otherwise put back a stale copy); a few minutes' tolerance is plenty.
 * Redirects aren't followed, so the signed body only ever goes to the configured URL.
 */
export type TimelapseChangeEvent = "timelapse.published" | "timelapse.updated" | "timelapse.deleted";

export interface TimelapseChangeNotification {
    event: TimelapseChangeEvent;
    id: string;
    timelapse?: OwnedTimelapse;
}

const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 3_000;

/**
 * The `x-lapse-signature` header for a request body sent at `timestamp` (unix seconds): `t=<timestamp>,v1=<hex>`, the
 * HMAC-SHA256 of `<timestamp>.<body>` as UTF-8, keyed by the shared secret.
 */
export function changeWebhookSignature(body: string, secret: string, timestamp: number): string {
    const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
    return `t=${timestamp},v1=${mac}`;
}

/**
 * Notifies the subscriber about a timelapse, without waiting for it. Call once the change is committed. Does nothing unless
 * `TIMELAPSE_WEBHOOK_URL` and `TIMELAPSE_WEBHOOK_SECRET` are set.
 */
export function notifyTimelapseChanged(event: TimelapseChangeEvent, timelapseId: string): void {
    if (!env.TIMELAPSE_WEBHOOK_URL || !env.TIMELAPSE_WEBHOOK_SECRET)
        return;

    void deliverTimelapseChange(event, timelapseId).catch((err: unknown) =>
        logWarning(`Couldn't send the change webhook for timelapse ${timelapseId}; the subscriber still gets it from the change feed.`, { err, event, timelapseId })
    );
}

/**
 * What `notifyTimelapseChanged` does in the background: describes the timelapse as it is now, then sends that, retrying once.
 */
export async function deliverTimelapseChange(event: TimelapseChangeEvent, timelapseId: string, retryDelayMs = RETRY_DELAY_MS): Promise<void> {
    const url = env.TIMELAPSE_WEBHOOK_URL;
    const secret = env.TIMELAPSE_WEBHOOK_SECRET;
    if (!url || !secret)
        return;

    const notification: TimelapseChangeNotification = { event, id: timelapseId };

    if (event !== "timelapse.deleted") {
        const timelapse = await database().timelapse.findFirst({
            where: { id: timelapseId },
            include: TIMELAPSE_INCLUDES,
            omit: TIMELAPSE_OMIT
        });

        // Deleted since - which the subscriber is told about separately.
        if (!timelapse)
            return;

        notification.timelapse = dtoOwnedTimelapse(timelapse);
    }

    const body = JSON.stringify(notification);

    // Signed per attempt, so a retry carries a fresh time.
    let failure = await post(url, body, secret);
    if (failure === null)
        return;

    await new Promise(resolve => setTimeout(resolve, retryDelayMs));

    failure = await post(url, body, secret);
    if (failure === null)
        return;

    logWarning(`Couldn't send the change webhook for timelapse ${timelapseId} (${failure}); the subscriber still gets it from the change feed.`, { event, timelapseId });
}

/**
 * Sends one request. Returns `null` once the subscriber has accepted it, and what went wrong otherwise.
 */
async function post(url: string, body: string, secret: string): Promise<string | null> {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-lapse-signature": changeWebhookSignature(body, secret, Math.floor(Date.now() / 1000))
            },
            body,
            // A redirect would re-send the signed body, private fields and all, wherever it points.
            redirect: "error",
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });

        // Nothing in the subscriber's answer is needed, and an unread body holds on to the connection.
        await res.body?.cancel().catch(() => {});

        return res.ok ? null : `HTTP ${res.status}`;
    }
    catch (err) {
        if (err instanceof Error && err.name === "TimeoutError")
            return `no answer within ${TIMEOUT_MS / 1000}s`;

        return err instanceof Error ? err.message : String(err);
    }
}
