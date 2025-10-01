import { z } from "zod";
import { procedure, router, protectedProcedure } from "../../trpc";
import { apiResult, ok } from "@/shared/common";
import crypto from "crypto";

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
     * Creates a snapshot.
     */
    create: protectedProcedure
        .input(
            z.object({
                /**
                 * The ID of the timelapse to associate with the snapshot. The user must be an owner of this timelapse.
                 * This field CANNOT be modified later.
                 */
                timelapseId: z.uuid(),

                /**
                 * The frame number in the timelapse sequence.
                 */
                frame: z.number().nonnegative(),
            })
        )
        .output(
            apiResult({
                /**
                 * The UUID of the created snapshot.
                 */
                id: z.uuid(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const timelapse = await db.timelapse.findFirst({
                where: { id: input.timelapseId },
            });

            if (!timelapse) {
                return { ok: false, error: "Timelapse not found" };
            }

            const canCreate =
                ctx.user.id === timelapse.ownerId ||
                ctx.user.permissionLevel === "ADMIN" ||
                ctx.user.permissionLevel === "ROOT";

            if (!canCreate) {
                return {
                    ok: false,
                    error: "You don't have permission to create snapshots for this timelapse"
                };
            }

            if (timelapse.isPublished) {
                return {
                    ok: false,
                    error: "Cannot add snapshots to published timelapse",
                };
            }

            const snapshotId = crypto.randomUUID();

            await db.snapshot.create({
                data: {
                    id: snapshotId,
                    timelapseId: input.timelapseId,
                    frame: input.frame,
                    createdAt: new Date(),
                },
            });

            return ok({ id: snapshotId });
        }),

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
        .mutation(async ({ ctx, input }) => {
            const snapshot = await db.snapshot.findFirst({
                where: { id: input.id },
                include: { timelapse: true },
            });

            if (!snapshot) {
                return { ok: false, error: "Snapshot not found" };
            }

            const canDelete =
                ctx.user.id === snapshot.timelapse.ownerId ||
                ctx.user.permissionLevel === "ADMIN" ||
                ctx.user.permissionLevel === "ROOT";

            if (!canDelete) {
                return {
                    ok: false,
                    error: "You don't have permission to delete this snapshot",
                };
            }

            if (snapshot.timelapse.isPublished) {
                return {
                    ok: false,
                    error: "Cannot delete snapshots from published timelapse",
                };
            }

            await db.snapshot.delete({
                where: { id: input.id },
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
        .query(async ({ ctx, input }) => {
            const timelapse = await db.timelapse.findFirst({
                where: { id: input.timelapseId },
            });

            if (!timelapse) {
                return { ok: false, error: "Timelapse not found" };
            }

            // Check if user can access this timelapse
            const canAccess =
                timelapse.isPublished ||
                (ctx.user && ctx.user.id === timelapse.ownerId) ||
                (ctx.user &&
                    (ctx.user.permissionLevel === "ADMIN" ||
                        ctx.user.permissionLevel === "ROOT"));

            if (!canAccess) {
                return { ok: false, error: "Timelapse not found" };
            }

            const snapshots = await db.snapshot.findMany({
                where: { timelapseId: input.timelapseId },
                orderBy: { frame: "asc" },
            });

            return ok({
                snapshots: snapshots.map(dtoSnapshot),
            });
        }),
});
