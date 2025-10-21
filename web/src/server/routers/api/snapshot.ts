import "@/server/allow-only-server";

import { z } from "zod";
import { procedure, router, protectedProcedure } from "@/server/trpc";
import { apiResult, err, ok, oneOf } from "@/shared/common";
import * as db from "@/generated/prisma";
import { PublicId } from "../common";
import { logInfo } from "@/server/serverCommon";

const database = new db.PrismaClient();

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
    createdAt: z.number().nonnegative(),
});

export default router({
    /**
     * Deletes a snapshot.
     */
    delete: protectedProcedure()
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
            logInfo(`snapshot/delete(id: ${req.input.id})`);

            const snapshot = await database.snapshot.findFirst({
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

            await database.snapshot.delete({
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
                 * The ID of the timelapse to find snapshots for.
                 */
                timelapseId: PublicId,
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
            logInfo(`snapshot/findByTimelapse(id: ${req.input.timelapseId})`);

            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.timelapseId },
            });

            if (!timelapse)
                return err("NOT_FOUND", "Couldn't find that timelapse!");

            // Check if user can access this timelapse
            const canAccess =
                timelapse.isPublished ||
                (req.ctx.user && req.ctx.user.id === timelapse.ownerId) ||
                (req.ctx.user && (req.ctx.user.permissionLevel in oneOf("ADMIN", "ROOT")));

            if (!canAccess)
                return err("NOT_FOUND", "Couldn't find that timelapse!");

            const snapshots = await database.snapshot.findMany({
                where: { timelapseId: req.input.timelapseId },
                orderBy: { frame: "asc" },
            });

            return ok({
                snapshots: snapshots.map(dtoSnapshot),
            });
        }),
});
