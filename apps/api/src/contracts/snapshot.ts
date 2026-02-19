import z from "zod";

import { apiResult, LapseDate, LapseId } from "@/common";
import { contract, NO_OUTPUT } from "@/internal";

/**
 * Represents a snapshot entity.
 */
export type Snapshot = z.infer<typeof SnapshotSchema>;
export const SnapshotSchema = z.object({
    /**
     * The UUID of the snapshot.
     */
    id: z.uuid(),

    /**
     * The ID of the timelapse this snapshot belongs to.
     */
    timelapseId: LapseId,

    /**
     * The frame number in the timelapse sequence.
     */
    frame: z.number().nonnegative(),

    /**
     * The creation timestamp of the snapshot.
     */
    createdAt: LapseDate,
});

export const snapshotRouterContract = {
    delete: contract("DELETE", "/snapshot/delete")
        .route({ summary: "Deletes a snapshot." })
        .input(z.object({
            id: z.uuid()
                .describe("The UUID of the snapshot to delete. The snapshot has to be owned by the calling user."),
        }))
        .output(NO_OUTPUT),

    findByTimelapse: contract("GET", "/snapshot/findByTimelapse")
        .route({ summary: "Finds all snapshots for a given timelapse." })
        .input(z.object({
            timelapseId: LapseId
                .describe("The ID of the timelapse to find snapshots for.")
        }))
        .output(apiResult({
            snapshots: z.array(SnapshotSchema)
                .describe("All snapshots for the timelapse.")
        }))
};
