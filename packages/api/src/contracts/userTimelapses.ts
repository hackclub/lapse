import { z } from "zod";

export const USER_TIMELAPSES_DEFAULT_LIMIT = 50;
export const USER_TIMELAPSES_MAX_LIMIT = 100;

export const UserTimelapseSummarySchema = z.object({
    id: z.string(),
    title: z.string(),
    createdAt: z.number(),
    visibility: z.enum(["UNLISTED", "PUBLIC", "FAILED_PROCESSING"]),
    duration: z.number().min(0),
    thumbnailUrl: z.string().nullable(),
    hackatimeProject: z.string().nullable(),
    snapshotCount: z.number().int().min(0),
    provenance: z.enum(["lookout", "legacy"]),
    processing: z.boolean()
});

export const UserTimelapsesResponseSchema = z.object({
    owner: z.object({
        lapseId: z.string(),
        handle: z.string(),
        displayName: z.string(),
        hackatimeId: z.string().nullable(),
        slackId: z.string().nullable()
    }),
    timelapses: z.array(UserTimelapseSummarySchema),
    total: z.number().int().min(0),
    nextCursor: z.string().nullable()
});

export type UserTimelapseSummary = z.infer<typeof UserTimelapseSummarySchema>;
export type UserTimelapsesResponse = z.infer<typeof UserTimelapsesResponseSchema>;
