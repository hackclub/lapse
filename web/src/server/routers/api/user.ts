import "@/server/allow-only-server";

import { z } from "zod";

import { apiResult, assert, descending, apiErr, when, apiOk } from "@/shared/common";
import { MIN_HANDLE_LENGTH, MAX_HANDLE_LENGTH } from "@/shared/constants";

import { router, protectedProcedure, publicProcedure, procedure } from "@/server/trpc";
import { logError, logRequest } from "@/server/serverCommon";
import { deleteTimelapse } from "@/server/routers/api/timelapse";
import { ApiDate, PublicId } from "@/server/routers/common";
import { database } from "@/server/db";

import * as db from "@/generated/prisma/client";

/**
 * Represents the permissions of a user.
 */
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;
export const PermissionLevelSchema = z.enum([
    "USER",  // normal permissions
    "ADMIN", // same as "USER", but adds the ability to remove and review projects
    "ROOT", // same as "ADMIN", but adds the ability to change the permissions of non-owners, alongside full project editing permissions
]);

/**
 * Represents a device that belongs to a user, which contains a private passkey. Passkeys are not
 */
export type KnownDevice = z.infer<typeof KnownDeviceSchema>;
export const KnownDeviceSchema = z.object({
    /**
     * The ID of the device.
     */
    id: z.uuid(),

    /**
     * A user-defined name for the device.
     */
    name: z.string()
});

export { MIN_HANDLE_LENGTH, MAX_HANDLE_LENGTH };

export const UserHandle = z.string().min(MIN_HANDLE_LENGTH).max(MAX_HANDLE_LENGTH);
export const UserDisplayName = z.string().min(1).max(24);
export const UserBio = z.string().max(160).default("");
export const UserUrlList = z.array(z.url().max(64).min(1)).max(4); 

/**
 * Data associated with a user model that should be exposed only to the represented user or
 * administrators.
 */
export type PrivateUserData = z.infer<typeof PrivateUserDataSchema>;
export const PrivateUserDataSchema = z.object({
    permissionLevel: PermissionLevelSchema,
    devices: z.array(KnownDeviceSchema),

    /**
     * Whether the user needs to re-authenticate. This is `true` when, for example, the user has authenticated
     * with Slack before, but has not yet logged in with Hackatime.
     */
    needsReauth: z.boolean()
});

/**
 * Represents a public view of a user.
 */
export type PublicUser = z.infer<typeof PublicUserSchema>;
export const PublicUserSchema = z.object({
    /**
     * The unique ID of the user.
     */
    id: PublicId,

    /**
     * The date when the user created their account.
     */
    createdAt: ApiDate,

    /**
     * The unique handle of the user.
     */
    handle: UserHandle,

    /**
     * The display name of the user. Cannot be blank.
     */
    displayName: UserDisplayName,

    /**
     * The profile picture URL of the user.
     */
    profilePictureUrl: z.url(),

    /**
     * The bio of the user. Maximum of 160 characters.
     */
    bio: UserBio,

    /**
     * Featured URLs that should be displayed on the user's page. This array has a maximum of 4 members.
     */
    urls: UserUrlList,

    /**
     * The ID of the user in Hackatime.
     */
    hackatimeId: z.string().nullable(),

    /**
     * The ID of the user in the Hack Club Slack.
     */
    slackId: z.string().regex(/^U[A-Z0-9]+$/).nullable()
});

/**
 * Represents a user, including all private fields.
 */
export type User = z.infer<typeof UserSchema>;
export const UserSchema = PublicUserSchema.safeExtend({
    /**
     * Fields only accessible to the owning user or administrators. Not present for a public
     * view of the user.
     */
    private: PrivateUserDataSchema
});

/**
 * Represents a `db.User` with related tables included.
 */
export type DbCompositeUser = db.User & { devices: db.KnownDevice[] };

/**
 * Converts a database representation of a known device to a runtime (API) one.
 */
export function dtoKnownDevice(entity: db.KnownDevice): KnownDevice {
    return {
        id: entity.id,
        name: entity.name
    };
}

/**
 * Converts a database representation of a user to a runtime (API) one.
 */
export function dtoPublicUser(entity: db.User): PublicUser {
    return {
        id: entity.id,
        createdAt: entity.createdAt.getTime(),
        displayName: entity.displayName,
        profilePictureUrl: entity.profilePictureUrl,
        bio: entity.bio,
        handle: entity.handle,
        urls: entity.urls,
        hackatimeId: entity.hackatimeId,
        slackId: entity.slackId
    };
}

/**
 * Converts a database representation of a user to a runtime (API) one, including all private fields.
 */
export function dtoUser(entity: DbCompositeUser): User {
    return {
        ...dtoPublicUser(entity),
        private: {
            permissionLevel: entity.permissionLevel,
            devices: entity.devices.map(dtoKnownDevice),
            needsReauth: entity.slackId !== null && entity.hackatimeId === null
        }
    };
}

export default router({
    myself: publicProcedure("GET", "/user/myself")
        .summary("Gets the information about the calling user. If the caller is not authenticated, returns `null` as the `user`.")
        .input(z.object({}))
        .output(apiResult({
            user: UserSchema.nullable()
        }))
        .query(async (req) => {
            logRequest("user/myself", req);
            
            if (!req.ctx.user)
                return apiOk({ user: null });

            const user = await database.user.findFirst({
                include: { devices: true },
                where: { id: req.ctx.user.id }
            });

            if (!user)
                return apiErr("NOT_FOUND", "Could not find your user account.");

            return apiOk({ user: dtoUser(user) });
        }),

    query: publicProcedure("GET", "/user/query")
        .summary("Finds a profile by its handle, ID, or Hackatime ID.")
        .input(
            z.object({
                id: PublicId.optional()
                    .describe("The ID of the profile to query. Can be undefined if another field is specified."),

                handle: z.string().optional()
                    .describe("The handle of the profile to query. Can be undefined if another field is specified."),

                hackatimeId: z.number().min(1).optional()
                    .describe("The Hackatime ID of the profile to query. Can be undefined if another field is specified."),
            })
        )
        .output(
            apiResult({
                user: z.union([UserSchema, PublicUserSchema]).nullable()
            })
        )
        .query(async (req) => {
            logRequest("user/query", req);
            
            let dbUser: DbCompositeUser | null;

            if (req.input.handle) {
                dbUser = await database.user.findFirst({
                    where: { handle: req.input.handle.trim() },
                    include: { devices: true }
                });
            }
            else if (req.input.id) {
                dbUser = await database.user.findFirst({
                    where: { id: req.input.id },
                    include: { devices: true }
                });
            }
            else if (req.input.hackatimeId) {
                dbUser = await database.user.findFirst({
                    where: { hackatimeId: req.input.hackatimeId.toString() },
                    include: { devices: true }
                });
            }
            else {
                return apiErr("MISSING_PARAMS", "No handle, user ID, or Hackatime ID specified"); 
            }

            if (!dbUser)
                return apiOk({ user: null });
            
            // Watch out! Make sure we never return a `User` to an unauthorized user here.
            const user: User | PublicUser = req.ctx.user?.id == dbUser.id
                ? dtoUser(dbUser)
                : dtoPublicUser(dbUser);
            
            return apiOk({ user });
        }),

    update: protectedProcedure(["user:write"], "PATCH", "/user/update")
        .summary("Updates user profile information.")
        .input(
            z.object({
                id: PublicId
                    .describe("The ID of the target user to edit. If the calling user has their permissionLevel set to 'USER', this field can only be set to their ID."),
                
                changes: z.object({
                    handle: UserHandle.optional(),
                    displayName: UserDisplayName.optional(),
                    bio: UserBio.optional(),
                    urls: UserUrlList.optional()
                })
                    .describe("The changes to apply to the user profile.")
            })
        )
        .output(
            apiResult({
                user: UserSchema
                    .describe("The new state of the user, after applying the updates.")
            })
        )
        .mutation(async (req) => {
            logRequest("user/update", req);
            
            // Check if user can edit this profile
            if (req.ctx.user.permissionLevel === "USER" && req.ctx.user.id !== req.input.id)
                return apiErr("NO_PERMISSION", "You can only edit your own profile");

            const changes = req.input.changes;
            const updateData: Partial<db.User> = {
                ...when(changes.displayName !== undefined, { displayName: changes.displayName }),
                ...when(changes.bio !== undefined, { bio: changes.bio }),
                ...when(changes.handle !== undefined, { handle: changes.handle }),
                ...when(changes.urls !== undefined, { urls: changes.urls })
            };

            const updatedUser = await database.user.update({
                where: { id: req.input.id },
                data: updateData,
                include: { devices: true }
            });

            return apiOk({ user: dtoUser(updatedUser) });
        }),

    getDevices: protectedProcedure(["user:read"], "GET", "/user/getDevices")
        .summary("Gets all devices registered by the currently authenticated user.")
        .input(z.object({}))
        .output(
            apiResult({
                devices: z.array(KnownDeviceSchema)
            })
        )
        .query(async (req) => {
            logRequest("user/getDevices", req);
            
            const devices = await database.knownDevice.findMany({
                where: { ownerId: req.ctx.user.id }
            });

            return apiOk({ devices: devices.map(dtoKnownDevice) });
        }),

    registerDevice: protectedProcedure(["user:write"], "POST", "/user/registerDevice")
        .summary("Creates a new device owned by a user, allocating a new, unique ID.")
        .input(
            z.object({
                name: z.string()
                    .describe("The initial string to use as the user-friendly device display name.")
            })
        )
        .output(
            apiResult({
                device: KnownDeviceSchema
            })
        )
        .mutation(async (req) => {
            logRequest("user/registerDevice", req);
            
            const device = await database.knownDevice.create({
                data: {
                    name: req.input.name,
                    ownerId: req.ctx.user.id
                }
            });

            return apiOk({ device: dtoKnownDevice(device) });
        }),

    removeDevice: protectedProcedure(["user:write"], "DELETE", "/user/removeDevice")
        .summary("Removes a device owned by a user.")
        .input(
            z.object({
                id: PublicId
                    .describe("The ID of the device to remove. The device must be owned by the calling user.")
            })
        )
        .output(apiResult({}))
        .mutation(async (req) => {
            logRequest("user/removeDevice", req);
            
            const device = await database.knownDevice.findFirst({
                where: { id: req.input.id, ownerId: req.ctx.user.id }
            });

            if (!device)
                return apiErr("DEVICE_NOT_FOUND", "That device doesn't seem to exist!");

            const timelapses = await database.timelapse.findMany({
                where: { deviceId: device.id }
            });

            if (timelapses.some(x => x.ownerId != req.ctx.user.id)) {
                logError("user.removeDevice", "A timelapse has a device that is not owned by the author!", { ownerId: req.ctx.user.id, timelapses });
                return apiErr("ERROR", "That device seems to be used by another user! Please report this to @ascpixi on Slack.");
            }

            await Promise.all(
                timelapses.map(async (timelapse) => {
                    await deleteTimelapse(timelapse.id, req.ctx.user);
                })
            );

            await database.knownDevice.delete({
                where: { id: req.input.id, ownerId: req.ctx.user.id }
            });

            return apiOk({});
        }),

    signOut: publicProcedure("POST", "/user/signOut")
        .summary("Signs out the current user by clearing the authentication cookie.")
        .input(z.object({}))
        .output(apiResult({}))
        .mutation(async (req) => {
            logRequest("user/signOut", req);
            
            if (req.ctx.res) {
                req.ctx.res.setHeader("Set-Cookie", [
                    "lapse-auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; HttpOnly; SameSite=Lax"
                ]);
            }
            return apiOk({});
        }),

    hackatimeProjects: protectedProcedure(["user:read"], "GET", "/user/hackatimeProjects")
        .summary("Gets a list of Hackatime projects that have been associated with the user's timelapses, including the total hour counts.")
        .input(z.object({}))
        .output(apiResult({
            projects: z.array(
                z.object({
                    name: z.string().min(1)
                        .describe("The name of the project."),

                    time: z.number().nonnegative()
                        .describe("The amount of time spent timelapsing.")
                })
            )
                .describe("All of the Hackatime projects associated with timelapses.")
        }))
        .query(async (req) => {
            const projects = new Map<string, number>();
            const timelapses = await database.timelapse.findMany({
                select: {
                    hackatimeProject: true,
                    duration: true
                },
                where: {
                    ownerId: req.ctx.user.id,
                    hackatimeProject: { not: null }
                }
            });

            for (const timelapse of timelapses) {
                assert(timelapse.hackatimeProject != null, "Timelapse had hackatimeProject == null when { not: null } was specified");

                projects.set(
                    timelapse.hackatimeProject,
                    (projects.get(timelapse.hackatimeProject) ?? 0) + timelapse.duration
                );
            }

            return apiOk({
                projects: projects
                    .entries()
                    .map(x => ({
                        name: x[0],
                        time: x[1]
                    }))
                    .toArray()
                    .toSorted(descending(x => x.time))
            });
        }),

    getTotalTimelapseTime: publicProcedure("GET", "/user/getTotalTimelapseTime")
        .summary("Queries the aggregate duration of all timelapses of a given user.")
        .input(z.object({
            id: PublicId.nullable()
                .describe("The ID of the user to query the total timelapse time of. If `null`, and the user is authenticated, the user's ID is used instead.")
        }))
        .output(apiResult({
            time: z.number().nonnegative()
                .describe("The aggregate duration of all timelapses of the queried user.")
        }))
        .query(async (req) => {
            if (!req.input.id && !req.ctx.user)
                return apiErr("MISSING_PARAMS", "'id' is required when not authenticated.");
            
            const aggregate = await database.timelapse.aggregate({
                _sum: { duration: true },
                where: { ownerId: req.input.id ?? req.ctx.user!.id }
            });

            return apiOk({ time: aggregate._sum.duration ?? 0 });
        }),

    emitHeartbeat: protectedProcedure(["user:write"], "POST", "/user/emitHeartbeat")
        .summary("Updates the last heartbeat time of the calling user to the current date. This is used to detect active users.")
        .input(z.object({}))
        .output(apiResult({}))
        .mutation(async (req) => {
            await database.user.update({
                data: { lastHeartbeat: new Date() },
                where: { id: req.ctx.user.id }
            });

            return apiOk({});
        })
});
