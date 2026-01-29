import "@/server/allow-only-server";

import { z } from "zod";

import { apiResult, apiErr, apiOk, isAdmin } from "@/shared/common";

import { router, protectedProcedure } from "@/server/trpc";
import { logRequest } from "@/server/serverCommon";
import { deleteTimelapse } from "@/server/routers/api/timelapse";
import { ApiDate, PublicId } from "@/server/routers/common";
import { database } from "@/server/db";
import {
    UserSchema,
    PermissionLevelSchema,
    BanRecordSchema,
    dtoUser,
    dtoBanRecord,
    type DbBanRecord
} from "@/server/routers/api/user";

import * as db from "@/generated/prisma/client";

export default router({
    /**
     * Sets the ban status of a user. Only administrators can use this endpoint.
     */
    setBanStatus: protectedProcedure()
        .input(z.object({
            /**
             * The ID of the user to ban or unban.
             */
            id: PublicId,

            /**
             * Whether to ban (`true`) or unban (`false`) the user.
             */
            isBanned: z.boolean(),

            /**
             * The public reason for the ban (shown to the user). Only used when `isBanned` is `true`.
             */
            reason: z.string().max(512).optional(),

            /**
             * The internal reason for the ban (only visible to admins). Only used when `isBanned` is `true`.
             */
            reasonInternal: z.string().max(512).optional()
        }))
        .output(apiResult({
            user: UserSchema
        }))
        .mutation(async (req) => {
            logRequest("admin/setBanStatus", req);

            const actor = req.ctx.user;

            if (!isAdmin(actor))
                return apiErr("NO_PERMISSION", "Only administrators can change ban status.");

            const target = await database.user.findFirst({
                where: { id: req.input.id },
                include: { devices: true }
            });

            if (!target)
                return apiErr("NOT_FOUND", "User not found.");

            if (target.permissionLevel !== "USER" && actor.permissionLevel !== "ROOT")
                return apiErr("NO_PERMISSION", "Only ROOT can change ban status of other administrators.");

            if (target.id === actor.id)
                return apiErr("NO_PERMISSION", "You cannot change your own ban status.");

            const reason = req.input.reason ?? "";
            const reasonInternal = req.input.reasonInternal ?? "";

            const [updatedUser, banRecord] = await database.$transaction([
                database.user.update({
                    where: { id: target.id },
                    data: { isBanned: req.input.isBanned },
                    include: { devices: true }
                }),
                database.banRecord.create({
                    data: {
                        action: req.input.isBanned ? "BAN" : "UNBAN",
                        reason: reason,
                        reasonInternal: reasonInternal,
                        targetId: target.id,
                        performedById: actor.id
                    },
                    include: { performedBy: true }
                })
            ]);

            return apiOk({ user: await dtoUser(updatedUser, banRecord) });
        }),

    /**
     * Gets the ban history for a user. Only administrators can use this endpoint.
     */
    getBanHistory: protectedProcedure()
        .input(z.object({
            /**
             * The ID of the user to get ban history for.
             */
            id: PublicId
        }))
        .output(apiResult({
            records: z.array(BanRecordSchema)
        }))
        .query(async (req) => {
            logRequest("admin/getBanHistory", req);

            const actor = req.ctx.user;
            if (!isAdmin(actor))
                return apiErr("NO_PERMISSION", "Only administrators can view ban history.");

            const records = await database.banRecord.findMany({
                where: { targetId: req.input.id },
                include: { performedBy: true },
                orderBy: { createdAt: "desc" }
            });

            return apiOk({ records: records.map(dtoBanRecord) });
        }),

    /**
     * Sets the permission level of a user. Only ROOT can use this endpoint.
     */
    setPermissionLevel: protectedProcedure()
        .input(z.object({
            id: PublicId,
            permissionLevel: PermissionLevelSchema
        }))
        .output(apiResult({ user: UserSchema }))
        .mutation(async (req) => {
            logRequest("admin/setPermissionLevel", req);

            const actor = req.ctx.user;
            if (actor.permissionLevel !== "ROOT")
                return apiErr("NO_PERMISSION", "Only ROOT can change permission levels.");

            if (req.input.id === actor.id)
                return apiErr("NO_PERMISSION", "You cannot change your own permission level.");

            const target = await database.user.findFirst({
                where: { id: req.input.id },
                include: { devices: true }
            });

            if (!target)
                return apiErr("NOT_FOUND", "User not found.");

            if (target.permissionLevel === "ROOT")
                return apiErr("NO_PERMISSION", "Cannot change permission level of ROOT users.");

            const updated = await database.user.update({
                where: { id: target.id },
                data: { permissionLevel: req.input.permissionLevel },
                include: { devices: true }
            });

            return apiOk({ user: await dtoUser(updated) });
        }),

    /**
     * Lists all users. Only administrators can use this endpoint.
     */
    list: protectedProcedure()
        .input(z.object({
            /**
             * Maximum number of users to return.
             */
            limit: z.number().int().min(1).max(100).default(50),

            /**
             * Cursor for pagination.
             */
            cursor: PublicId.optional(),

            /**
             * If `true`, only returns banned users.
             */
            onlyBanned: z.boolean().optional()
        }))
        .output(apiResult({
            users: z.array(UserSchema),
            nextCursor: PublicId.optional()
        }))
        .query(async (req) => {
            logRequest("admin/list", req);

            const actor = req.ctx.user;
            if (!isAdmin(actor))
                return apiErr("NO_PERMISSION", "Only administrators can list users.");

            const where: db.Prisma.UserWhereInput = {
                ...(req.input.onlyBanned ? { isBanned: true } : {})
            };

            const users = await database.user.findMany({
                where,
                include: { devices: true },
                take: req.input.limit + 1,
                orderBy: { createdAt: "desc" },
                ...(req.input.cursor ? { cursor: { id: req.input.cursor }, skip: 1 } : {})
            });

            const hasMore = users.length > req.input.limit;
            const items = hasMore ? users.slice(0, -1) : users;

            return apiOk({
                users: await Promise.all(items.map(u => dtoUser(u))),
                nextCursor: hasMore ? items[items.length - 1].id : undefined
            });
        }),

    /**
     * Deletes a user and all their associated data. Only ROOT can use this endpoint.
     */
    deleteUser: protectedProcedure()
        .input(z.object({
            /**
             * The ID of the user to delete.
             */
            id: PublicId
        }))
        .output(apiResult({}))
        .mutation(async (req) => {
            logRequest("admin/deleteUser", req);

            const actor = req.ctx.user;

            if (actor.permissionLevel !== "ROOT")
                return apiErr("NO_PERMISSION", "Only ROOT can delete users.");

            const target = await database.user.findFirst({
                where: { id: req.input.id }
            });

            if (!target)
                return apiErr("NOT_FOUND", "User not found.");

            if (target.id === actor.id)
                return apiErr("NO_PERMISSION", "You cannot delete your own account.");

            if (target.permissionLevel === "ROOT")
                return apiErr("NO_PERMISSION", "Cannot delete ROOT users.");

            const timelapses = await database.timelapse.findMany({
                where: { ownerId: target.id }
            });

            for (const timelapse of timelapses) {
                await deleteTimelapse(timelapse.id, "SERVER");
            }

            await database.comment.deleteMany({
                where: { authorId: target.id }
            });

            await database.knownDevice.deleteMany({
                where: { ownerId: target.id }
            });

            await database.uploadToken.deleteMany({
                where: { ownerId: target.id }
            });

            await database.draftTimelapse.deleteMany({
                where: { ownerId: target.id }
            });

            await database.user.delete({
                where: { id: target.id }
            });

            return apiOk({});
        }),

    /**
     * Gets the ban information for the calling user. Used by the banned page to display ban details.
     */
    getMyBanInfo: protectedProcedure()
        .input(z.object({}))
        .output(apiResult({
            ban: z.object({
                bannedAt: ApiDate,
                reason: z.string(),
                reasonInternal: z.string(),
                performedBy: z.object({
                    id: PublicId,
                    displayName: z.string()
                })
            }).nullable()
        }))
        .query(async (req) => {
            logRequest("admin/getMyBanInfo", req);

            if (!req.ctx.user.isBanned)
                return apiOk({ ban: null });

            const latestBanRecord = await database.banRecord.findFirst({
                where: {
                    targetId: req.ctx.user.id,
                    action: "BAN"
                },
                orderBy: { createdAt: "desc" },
                include: { performedBy: true }
            });

            if (!latestBanRecord)
                return apiOk({ ban: null });

            return apiOk({
                ban: {
                    bannedAt: latestBanRecord.createdAt.getTime(),
                    reason: latestBanRecord.reason,
                    reasonInternal: latestBanRecord.reasonInternal,
                    performedBy: {
                        id: latestBanRecord.performedBy.id,
                        displayName: latestBanRecord.performedBy.displayName
                    }
                }
            });
        })
});
