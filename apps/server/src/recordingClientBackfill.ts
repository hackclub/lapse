import type * as db from "@/generated/prisma/client.js";

import { database, redis } from "@/db.js";
import { logError, logInfo } from "@/logging.js";
import * as lookout from "@/lookout.js";

const LOCK_KEY = "lapse:recording_client_backfill";
/** The backfill is idempotent, so the lock only keeps replicas starting together from doubling Lookout's load. */
const LOCK_TTL_MS = 30 * 60_000;
const PAGE_SIZE = 500;

/**
 * Fills in `Timelapse.recordedWith` for Lookout timelapses published before it was tracked, by asking Lookout what
 * client each session was recorded with. Every timelapse it reaches gets a value (`UNKNOWN` when Lookout can't say),
 * so each page makes progress and the loop ends. Once everything is filled in, this is a single empty query.
 */
export async function backfillRecordingClients(): Promise<void> {
    const held = await redis().set(LOCK_KEY, "1", "PX", LOCK_TTL_MS, "NX");
    if (held !== "OK")
        return;

    let filled = 0;

    while (true) {
        const page = await database().timelapse.findMany({
            where: { recordedWith: null, lookoutSessionId: { not: null } },
            select: { id: true, lookoutSessionId: true },
            take: PAGE_SIZE,
        });

        if (page.length === 0)
            break;

        const batch = await lookout.getSessions(page.flatMap(x => x.lookoutSessionId ?? []));
        const byClient = new Map<db.RecordingClient, string[]>();

        for (const timelapse of page) {
            const session = timelapse.lookoutSessionId ? batch.sessions.get(timelapse.lookoutSessionId) : undefined;
            const client = lookout.recordingClientOf(session?.clientInfo ?? null);
            byClient.set(client, [...(byClient.get(client) ?? []), timelapse.id]);
        }

        for (const [client, ids] of byClient) {
            await database().timelapse.updateMany({
                where: { id: { in: ids }, recordedWith: null },
                data: { recordedWith: client },
            });
        }

        filled += page.length;
    }

    if (filled > 0)
        logInfo(`Backfilled the recording client of ${filled} timelapses.`);
}

export function startRecordingClientBackfill(): void {
    void backfillRecordingClients().catch(err => logError("Recording client backfill failed.", { err }));
}
