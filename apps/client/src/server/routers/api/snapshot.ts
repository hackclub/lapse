import "@/server/allow-only-server";

import { z } from "zod";

import { apiResult, apiErr, apiOk, oneOf } from "@/shared/common";

import { router, protectedProcedure, publicProcedure } from "@/server/trpc";
import { ApiDate, PublicId } from "@/server/routers/common";
import { logRequest } from "@/server/serverCommon";
import { database } from "@/server/db";

import * as db from "@/generated/prisma/client";

/**
 * Converts a database representation of a snapshot to a runtime (API) one.
 */
export function dtoSnapshot(entity: db.Snapshot): Snapshot {
    return {
        id: entity.id,
        timelapseId: entity.timelapseId,
        frame: entity.frame,
        createdAt: entity.createdAt.getTime(),
    };
}

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
    timelapseId: PublicId,

    /**
     * The frame number in the timelapse sequence.
     */
    frame: z.number().nonnegative(),

    /**
     * The creation timestamp of the snapshot.
     */
    createdAt: ApiDate,
});

export default router({
    delete: protectedProcedure(["snapshot:write"], "DELETE", "/snapshot/delete")
        .summary("Deletes a snapshot.")
        .input(
            z.object({
                id: z.uuid()
                    .describe("The UUID of the snapshot to delete. The snapshot has to be owned by the calling user."),
            })
        )
        .output(apiResult({}))
        .mutation(async (req) => {
            logRequest("snapshot/delete", req);

            const snapshot = await database.snapshot.findFirst({
                where: { id: req.input.id },
                include: { timelapse: true },
            });

            if (!snapshot)
                return apiErr("NOT_FOUND", "Snapshot not found");

            const canDelete =
                req.ctx.user.id === snapshot.timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canDelete)
                return apiErr("NO_PERMISSION", "You don't have permission to delete this snapshot");

            if (snapshot.timelapse.isPublished)
                return apiErr("NOT_MUTABLE", "Cannot delete snapshots from published timelapse");

            await database.snapshot.delete({
                where: { id: req.input.id },
            });

            return apiOk({});
        }),

    findByTimelapse: publicProcedure("GET", "/snapshot/findByTimelapse")
        .summary("Finds all snapshots for a given timelapse.")
        .input(
            z.object({
                timelapseId: PublicId
                    .describe("The ID of the timelapse to find snapshots for.")
            })
        )
        .output(
            apiResult({
                snapshots: z.array(SnapshotSchema)
                    .describe("All snapshots for the timelapse."),
            })
        )
        .query(async (req) => {
            logRequest("snapshot/findByTimelapse", req);
            
            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.timelapseId },
            });

            if (!timelapse)
                return apiErr("NOT_FOUND", "Couldn't find that timelapse!");

            // Check if user can access this timelapse
            const canAccess =
                timelapse.isPublished ||
                (req.ctx.user && req.ctx.user.id === timelapse.ownerId) ||
                (req.ctx.user && (req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT")));

            if (!canAccess)
                return apiErr("NOT_FOUND", "Couldn't find that timelapse!");

            const snapshots = await database.snapshot.findMany({
                where: { timelapseId: req.input.timelapseId },
                orderBy: { frame: "asc" },
            });

            return apiOk({
                snapshots: snapshots.map(dtoSnapshot),
            });
        }),
});
