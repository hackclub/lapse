import { z } from "zod";

export const DetectionEvidenceOwnerSchema = z.object({
    lapseId: z.string(),
    handle: z.string(),
    displayName: z.string(),
    hackatimeId: z.string().nullable()
});

export const DetectionEvidenceRecordingSchema = z.object({
    title: z.string(),
    createdAt: z.number(),
    visibility: z.enum(["UNLISTED", "PUBLIC", "FAILED_PROCESSING"]),
    duration: z.number().min(0),
    playbackUrl: z.string().nullable(),
    thumbnailUrl: z.string().nullable(),
    hackatimeProject: z.string().nullable(),
    snapshotTimestamps: z.array(z.number())
});

export const AvailableLookoutEvidenceSchema = z.object({
    state: z.literal("available"),
    status: z.string(),
    trackingMode: z.string(),
    trackedSeconds: z.number().min(0),
    activeSeconds: z.number().min(0),
    screenshotCount: z.number().int().min(0),
    captureRange: z.object({
        first: z.number().nullable(),
        last: z.number().nullable()
    }),
    captureTimestamps: z.array(z.number()),
    clientInfo: z.string().nullable()
});

export const LookoutEvidenceSchema = z.discriminatedUnion("state", [
    AvailableLookoutEvidenceSchema,
    z.object({ state: z.literal("unavailable") })
]);

export const DetectionEvidenceResultSchema = z.discriminatedUnion("status", [
    z.object({
        timelapseId: z.string(),
        status: z.literal("found"),
        recording: DetectionEvidenceRecordingSchema,
        owner: DetectionEvidenceOwnerSchema,
        provenance: z.enum(["lookout", "legacy"]),
        lookoutEvidence: LookoutEvidenceSchema.nullable()
    }),
    z.object({
        timelapseId: z.string(),
        status: z.literal("not_found")
    })
]);

export const DetectionEvidenceResponseSchema = z.object({
    results: z.array(DetectionEvidenceResultSchema)
});

export type DetectionEvidenceResult = z.infer<typeof DetectionEvidenceResultSchema>;
export type DetectionEvidenceResponse = z.infer<typeof DetectionEvidenceResponseSchema>;
