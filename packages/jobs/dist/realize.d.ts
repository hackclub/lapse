import { z } from "zod";
/**
 * Represents the inputs for a `realize` job.
 */
export type RealizeJobInputs = z.infer<typeof RealizeJobInputsSchema>;
export declare const RealizeJobInputsSchema: z.ZodObject<{
    timelapseId: z.ZodString;
    sessionUrls: z.ZodArray<z.ZodURL>;
    passkey: z.ZodString;
    editList: z.ZodArray<z.ZodObject<{
        begin: z.ZodNumber;
        end: z.ZodNumber;
        kind: z.ZodEnum<{
            CUT: "CUT";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * Represents the outputs for a `realize` job.
 */
export type RealizeJobOutputs = z.infer<typeof RealizeJobOutputsSchema>;
export declare const RealizeJobOutputsSchema: z.ZodObject<{
    timelapseId: z.ZodString;
    videoKey: z.ZodString;
    thumbnailKey: z.ZodString;
}, z.core.$strip>;
/**
 * Identifies the `realize` job queue within BullMQ.
 */
export declare const REALIZE_JOB_QUEUE_NAME = "lapse-realize";
//# sourceMappingURL=realize.d.ts.map