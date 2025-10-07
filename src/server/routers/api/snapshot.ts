import { z } from "zod";
import { procedure, router, protectedProcedure } from "../../trpc";
import { apiResult, err, ok, oneOf } from "@/shared/common";

import { PrismaClient } from "../../../generated/prisma";
import type { Snapshot as DbSnapshot } from "../../../generated/prisma";

const db = new PrismaClient();

/**
 * Converts a database representation of a snapshot to a runtime (API) one.
 */
export function dtoSnapshot(entity: DbSnapshot): Snapshot {
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
    timelapseId: z.uuid(),

    /**
     * The frame number in the timelapse sequence.
     */
    frame: z.number().nonnegative(),

    /**
     * The creation timestamp of the snapshot.
     */
    createdAt: z.number().nonnegative(),
});

export default router({
    /**
     * Deletes a snapshot.
     */
    delete: protectedProcedure
        .input(
            z.object({
                /**
                 * The UUID of the snapshot to delete. The snapshot has to be owned by the calling user.
                 */
                id: z.uuid(),
            })
        )
        .output(apiResult({}))
        .mutation(async (req) => {
            const snapshot = await db.snapshot.findFirst({
                where: { id: req.input.id },
                include: { timelapse: true },
            });

            if (!snapshot)
                return err("NOT_FOUND", "Snapshot not found");

            const canDelete =
                req.ctx.user.id === snapshot.timelapse.ownerId ||
                req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canDelete)
                return err("NO_PERMISSION", "You don't have permission to delete this snapshot");

            if (snapshot.timelapse.isPublished)
                return err("NOT_MUTABLE", "Cannot delete snapshots from published timelapse");

            await db.snapshot.delete({
                where: { id: req.input.id },
            });

            return ok({});
        }),

    /**
     * Finds all snapshots for a given timelapse.
     */
    findByTimelapse: procedure
        .input(
            z.object({
                /**
                 * The UUID of the timelapse to find snapshots for.
                 */
                timelapseId: z.uuid(),
            })
        )
        .output(
            apiResult({
                /**
                 * All snapshots for the timelapse.
                 */
                snapshots: z.array(SnapshotSchema),
            })
        )
        .query(async (req) => {
            const timelapse = await db.timelapse.findFirst({
                where: { id: req.input.timelapseId },
            });

            if (!timelapse)
                return err("NOT_FOUND", "Timelapse not found");

            // Check if user can access this timelapse
            const canAccess =
                timelapse.isPublished ||
                (req.ctx.user && req.ctx.user.id === timelapse.ownerId) ||
                (req.ctx.user && (req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT")));

            if (!canAccess)
                return err("NOT_FOUND", "Timelapse not found");

            const snapshots = await db.snapshot.findMany({
                where: { timelapseId: req.input.timelapseId },
                orderBy: { frame: "asc" },
            });

            return ok({
                snapshots: snapshots.map(dtoSnapshot),
            });
        }),
});
