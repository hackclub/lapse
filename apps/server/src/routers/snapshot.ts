import { z } from "zod";
import { implement } from "@orpc/server";
import { globalRouterContract, snapshotRouterContract, type LeaderboardUserEntry, type Snapshot } from "@hackclub/lapse-api";
import { daysAgo, descending, oneOf } from "@hackclub/lapse-shared";

import { logMiddleware, requiredAuth, type Context } from "@/router.js";
import { dtoPublicTimelapse } from "@/routers/timelapse.js";
import { apiErr, apiOk } from "@/common.js";
import { database } from "@/db.js";
import { logError } from "@/logging.js";

import * as db from "@/generated/prisma/client.js";

const os = implement(snapshotRouterContract)
    .$context<Context>()
    .use(logMiddleware);

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

export default os.router({
    delete: os.delete
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const snapshot = await database.snapshot.findFirst({
                where: { id: req.input.id },
                include: { timelapse: true },
            });

            if (!snapshot)
                return apiErr("NOT_FOUND", "Snapshot not found");

            const canDelete =
                caller.id === snapshot.timelapse.ownerId ||
                caller.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canDelete)
                return apiErr("NO_PERMISSION", "You don't have permission to delete this snapshot");

            if (snapshot.timelapse.isPublished)
                return apiErr("NOT_MUTABLE", "Cannot delete snapshots from published timelapse");

            await database.snapshot.delete({
                where: { id: req.input.id },
            });

            return apiOk({});
        }),

    findByTimelapse: os.findByTimelapse
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapse = await database.timelapse.findFirst({
                where: { id: req.input.timelapseId },
            });

            if (!timelapse)
                return apiErr("NOT_FOUND", "Couldn't find that timelapse!");

            // Check if user can access this timelapse
            const canAccess =
                timelapse.isPublished ||
                (caller && caller.id === timelapse.ownerId) ||
                (caller && (caller.permissionLevel in oneOf("ADMIN", "ROOT")));

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
