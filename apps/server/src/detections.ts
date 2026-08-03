import type { FastifyInstance } from "fastify";
import type { DetectionEvidenceResult, DetectionEvidenceResponse } from "@hackclub/lapse-api";

import { ADMIN_ROUTES, registerAdminRoute, type AdminReply } from "@/adminKey.js";
import { database } from "@/db.js";
import { env } from "@/env.js";
import * as lookout from "@/lookout.js";

const MAX_TIMELAPSE_IDS = 25;

type DetectionTimelapse = {
    id: string;
    name: string;
    createdAt: Date;
    visibility: "UNLISTED" | "PUBLIC" | "FAILED_PROCESSING";
    duration: number;
    s3Key: string | null;
    thumbnailS3Key: string | null;
    lookoutVideoUrl: string | null;
    lookoutThumbnailUrl: string | null;
    hackatimeProject: string | null;
    snapshots: Date[];
    lookoutSessionId: string | null;
    lookoutToken: string | null;
    owner: {
        id: string;
        handle: string;
        displayName: string;
        hackatimeId: string | null;
    };
};

type DetectionDependencies = {
    findTimelapses(ids: string[]): Promise<DetectionTimelapse[]>;
    getSession: typeof lookout.getSession;
    getTimings: typeof lookout.getTimings;
    publicStorageUrl: string;
};

function parseTimelapseIds(body: unknown): string[] | null {
    if (!body || typeof body !== "object" || !("timelapseIds" in body))
        return null;

    const ids = (body as { timelapseIds?: unknown }).timelapseIds;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id.trim()))
        return null;

    const unique = [...new Set(ids.map(id => id.trim()))];
    return unique.length <= MAX_TIMELAPSE_IDS ? unique : null;
}

function mediaUrl(stored: string | null, key: string | null, publicStorageUrl: string): string | null {
    return stored ?? (key ? `${publicStorageUrl}/${key}` : null);
}

async function lookoutEvidence(
    timelapse: DetectionTimelapse,
    deps: DetectionDependencies
): Promise<Extract<DetectionEvidenceResult, { status: "found" }>["lookoutEvidence"]> {
    if (!timelapse.lookoutSessionId)
        return null;
    if (!timelapse.lookoutToken)
        return { state: "unavailable" };

    try {
        const [session, timings] = await Promise.all([
            deps.getSession(timelapse.lookoutSessionId),
            deps.getTimings(timelapse.lookoutToken)
        ]);
        const timestamps = timings.timestamps.map(timestamp => new Date(timestamp).getTime());
        return {
            state: "available",
            status: session.session.status,
            trackingMode: session.session.trackingMode,
            trackedSeconds: session.trackedSeconds,
            activeSeconds: session.session.totalActiveSeconds,
            screenshotCount: session.screenshotCount,
            captureRange: {
                first: timings.first ? new Date(timings.first).getTime() : null,
                last: timings.last ? new Date(timings.last).getTime() : null
            },
            captureTimestamps: timestamps,
            clientInfo: session.clientInfo ?? timings.clientInfo
        };
    }
    catch {
        return { state: "unavailable" };
    }
}

async function foundResult(
    timelapse: DetectionTimelapse,
    deps: DetectionDependencies
): Promise<DetectionEvidenceResult> {
    const provenance = timelapse.lookoutSessionId ? "lookout" : "legacy";
    return {
        timelapseId: timelapse.id,
        status: "found",
        recording: {
            title: timelapse.name,
            createdAt: timelapse.createdAt.getTime(),
            visibility: timelapse.visibility,
            duration: timelapse.duration,
            playbackUrl: mediaUrl(timelapse.lookoutVideoUrl, timelapse.s3Key, deps.publicStorageUrl),
            thumbnailUrl: mediaUrl(timelapse.lookoutThumbnailUrl, timelapse.thumbnailS3Key, deps.publicStorageUrl),
            hackatimeProject: timelapse.hackatimeProject,
            snapshotTimestamps: timelapse.snapshots.map(snapshot => snapshot.getTime())
        },
        owner: {
            lapseId: timelapse.owner.id,
            handle: timelapse.owner.handle,
            displayName: timelapse.owner.displayName,
            hackatimeId: timelapse.owner.hackatimeId
        },
        provenance,
        lookoutEvidence: await lookoutEvidence(timelapse, deps)
    };
}

export async function handleDetectionRequest(
    body: unknown,
    deps: DetectionDependencies
): Promise<AdminReply<DetectionEvidenceResponse>> {
    const ids = parseTimelapseIds(body);
    if (!ids)
        return { statusCode: 400, body: { error: `timelapseIds must contain at most ${MAX_TIMELAPSE_IDS} non-empty strings` } };

    const timelapses = await deps.findTimelapses(ids);
    const byId = new Map(timelapses.map(timelapse => [timelapse.id, timelapse]));
    const results = await Promise.all(ids.map(id => {
        const timelapse = byId.get(id);
        return timelapse ? foundResult(timelapse, deps) : { timelapseId: id, status: "not_found" as const };
    }));
    return { statusCode: 200, body: { results } };
}

const dependencies = (): DetectionDependencies => ({
    findTimelapses: ids => database().timelapse.findMany({
        where: { id: { in: ids } },
        include: { owner: true }
    }),
    getSession: lookout.getSession,
    getTimings: lookout.getTimings,
    publicStorageUrl: env.S3_PUBLIC_URL_PUBLIC
});

export function registerDetectionRoutes(server: FastifyInstance): void {
    registerAdminRoute(server, ADMIN_ROUTES.detections, body =>
        handleDetectionRequest(body, dependencies()));
}
