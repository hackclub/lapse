import "@/server/allow-only-server";

import { z } from "zod";

import { apiResult, apiErr, apiOk, isAdmin } from "@/shared/common";

import { router, adminProcedure } from "@/server/trpc";
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
    setBanStatus: adminProcedure()
        .summary("Sets the ban status of a user. Only administrators can use this endpoint.")
        .input(z.object({
            id: PublicId
                .describe("The ID of the user to ban or unban."),

            isBanned: z.boolean()
                .describe("Whether to ban (`true`) or unban (`false`) the user."),

            reason: z.string().max(512).optional()
                .describe("The public reason for the ban (shown to the user). Required when `isBanned` is `true`."),

            reasonInternal: z.string().max(512).optional()
                .describe("The internal reason for the ban (only visible to admins). Only used when `isBanned` is `true`.")
        }))
        .output(apiResult({
            user: UserSchema
        }))
        .mutation(async (req) => {
            logRequest("admin/setBanStatus", req);

            const actor = req.ctx.user;
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

    getBanHistory: adminProcedure()
        .summary("Gets the ban history for a user. Only administrators can use this endpoint.")
        .input(z.object({
            id: PublicId
                .describe("The ID of the user to get ban history for.")
        }))
        .output(apiResult({
            records: z.array(BanRecordSchema)
        }))
        .query(async (req) => {
            logRequest("admin/getBanHistory", req);

            const records = await database.banRecord.findMany({
                where: { targetId: req.input.id },
                include: { performedBy: true },
                orderBy: { createdAt: "desc" }
            });

            return apiOk({ records: records.map(dtoBanRecord) });
        }),

    setPermissionLevel: adminProcedure()
        .summary("Sets the permission level of a user. Only ROOT can use this endpoint.")
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

    list: adminProcedure()
        .summary("Lists all users. Only administrators can use this endpoint.")
        .input(z.object({
            limit: z.number().int().min(1).max(100).default(50)
                .describe("Maximum number of users to return."),

            cursor: PublicId.optional()
                .describe("Cursor for pagination."),

            onlyBanned: z.boolean().optional()
                .describe("If `true`, only returns banned users.")
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

    deleteUser: adminProcedure()
        .summary("Deletes a user and all their associated data. Only ROOT can use this endpoint.")
        .input(z.object({
            id: PublicId
                .describe("The ID of the user to delete.")
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
        })   
});
