import "../../allow-only-server";

import { z } from "zod";

import * as db from "../../../generated/prisma";
import { procedure, router, protectedProcedure } from "../../trpc";
import { apiResult, assert, err, ok, when } from "../../../shared/common";
import { Hackatime } from "../../hackatime";
import { logError, logWarning, logRequest } from "../../serverCommon";
import { deleteTimelapse } from "./timelapse";
import { PublicId } from "../common";

const database = new db.PrismaClient();

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

export const UserHandle = z.string().min(3).max(16);
export const UserDisplayName = z.string().min(1).max(24);
export const UserBio = z.string().max(160).default("");
export const UserUrlList = z.array(z.url().max(64).min(1)).max(4); 
export const UserHackatimeApiKey = z.uuid().optional();

/**
 * Data associated with a user model that should be exposed only to the represented user or
 * administrators.
 */
export type PrivateUserData = z.infer<typeof PrivateUserDataSchema>;
export const PrivateUserDataSchema = z.object({
    permissionLevel: PermissionLevelSchema,
    devices: z.array(KnownDeviceSchema),
    hackatimeApiKey: UserHackatimeApiKey
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
    createdAt: z.number().nonnegative(),

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
     * Featured URLs that should be displayed on the user"s page. This array has a maximum of 4 members.
     */
    urls: UserUrlList
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
        urls: entity.urls
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
            hackatimeApiKey: entity.hackatimeApiKey ?? undefined,
        }
    };
}

export default router({
    /**
     * Gets the information about the calling user. If the caller is not authenticated,
     * returns `null` as the `user`.
     */
    myself: procedure
        .input(z.object({}))
        .output(apiResult({
            user: UserSchema.nullable()
        }))
        .query(async (req) => {
            logRequest("user/myself", req);
            
            if (!req.ctx.user)
                return ok({ user: null });

            const user = await database.user.findFirst({
                include: { devices: true },
                where: { id: req.ctx.user.id }
            });

            if (!user)
                return err("NOT_FOUND", "Could not find your user account.");

            return ok({ user: dtoUser(user) });
        }),

    /**
     * Finds a profile by its handle *or* ID.
     */
    query: procedure
        .input(
            z.object({
                /**
                 * The ID of the profile to query. Can be undefined if `handle` is specified.
                 */
                id: PublicId.optional(),

                /**
                 * The handle of the profile to query. Can be undefined if `id` is specified.
                 */
                handle: z.string().optional()
            })
        )
        .output(
            apiResult({
                user: z.union([PublicUserSchema, UserSchema]).nullable()
            })
        )
        .query(async (req) => {
            logRequest("user/query", req);
            
            if (!req.input.handle && !req.input.id)
                return err("MISSING_PARAMS", "No handle or user ID specified"); 

            let dbUser: DbCompositeUser | null;

            if (req.input.handle) {
                dbUser = await database.user.findFirst({
                    where: { handle: req.input.handle.trim() },
                    include: { devices: true }
                });
            }
            else {
                assert(req.input.id != undefined, "Both req.input.handle and req.input.id were undefined");
                dbUser = await database.user.findFirst({
                    where: { id: req.input.id },
                    include: { devices: true }
                });
            }

            if (!dbUser)
                return ok({ user: null });
            
            // Watch out! Make sure we never return a `User` to an unauthorized user here.
            const user: User | PublicUser = req.ctx.user?.id == dbUser.id
                ? dtoUser(dbUser)
                : dtoPublicUser(dbUser);
            
            return ok({ user });
        }),

    /**
     * Updates user profile information.
     */
    update: protectedProcedure()
        .input(
            z.object({
                /**
                 * The ID of the target user to edit. If the calling user has their permissionLevel set to "USER",
                 * this field can only be set to their ID.
                 */
                id: PublicId,

                /**
                 * The changes to apply to the user profile.
                 */
                changes: z.object({
                    handle: UserHandle.optional(),
                    displayName: UserDisplayName.optional(),
                    bio: UserBio.optional(),
                    urls: UserUrlList.optional(),
                    hackatimeApiKey: UserHackatimeApiKey.optional()
                })
            })
        )
        .output(
            apiResult({
                /**
                 * The new state of the user, after applying the updates.
                 */
                user: UserSchema
            })
        )
        .mutation(async (req) => {
            logRequest("user/update", req);
            
            // Check if user can edit this profile
            if (req.ctx.user.permissionLevel === "USER" && req.ctx.user.id !== req.input.id)
                return err("NO_PERMISSION", "You can only edit your own profile");

            const changes = req.input.changes;
            const updateData: Partial<db.User> = {
                ...when(changes.displayName !== undefined, { displayName: changes.displayName }),
                ...when(changes.bio !== undefined, { bio: changes.bio }),
                ...when(changes.handle !== undefined, { handle: changes.handle }),
                ...when(changes.urls !== undefined, { urls: changes.urls }),
                ...when(changes.hackatimeApiKey !== undefined, { hackatimeApiKey: changes.hackatimeApiKey })
            };

            if (changes.hackatimeApiKey) {
                const hackatime = new Hackatime(changes.hackatimeApiKey);

                try {
                    await hackatime.currentUserStats();
                }
                catch (error) {
                    logWarning("user.update", "Error caught when verifying a Hackatime API key!", { error });
                    return err("HACKATIME_ERROR", "You provided an invalid Hackatime API key!");
                }
            }

            const updatedUser = await database.user.update({
                where: { id: req.input.id },
                data: updateData,
                include: { devices: true }
            });

            return ok({ user: dtoUser(updatedUser) });
        }),

    /**
     * Gets all devices registered by the currently authenticated user.
     */
    getDevices: protectedProcedure()
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

            return ok({ devices: devices.map(dtoKnownDevice) });
        }),

    /**
     * Creates a new device owned by a user, allocating a new, unique ID.
     */
    registerDevice: protectedProcedure()
        .input(
            z.object({
                /**
                 * The initial string to use as the user-friendly device display name.
                 */
                name: z.string() 
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

            return ok({ device: dtoKnownDevice(device) });
        }),

    /**
     * Removes a device owned by a user.
     */
    removeDevice: protectedProcedure()
        .input(
            z.object({
                /**
                 * The ID of the device to remove. The device must be owned by the calling user.
                 */
                id: PublicId
            })
        )
        .output(apiResult({}))
        .mutation(async (req) => {
            logRequest("user/removeDevice", req);
            
            const device = await database.knownDevice.findFirst({
                where: { id: req.input.id, ownerId: req.ctx.user.id }
            });

            if (!device)
                return err("DEVICE_NOT_FOUND", "That device doesn't seem to exist!");

            const timelapses = await database.timelapse.findMany({
                where: { deviceId: device.id }
            });

            if (timelapses.some(x => x.ownerId != req.ctx.user.id)) {
                logError("user.removeDevice", "A timelapse has a device that is not owned by the author!", { ownerId: req.ctx.user.id, timelapses });
                return err("ERROR", "That device seems to be used by another user! Please report this to @ascpixi on Slack.");
            }

            await Promise.all(
                timelapses.map(async (timelapse) => {
                    await deleteTimelapse(timelapse.id);
                })
            );

            await database.knownDevice.delete({
                where: { id: req.input.id, ownerId: req.ctx.user.id }
            });

            return ok({});
        }),

    /**
     * Signs out the current user by clearing the authentication cookie.
     */
    signOut: procedure
        .input(z.object({}))
        .output(apiResult({}))
        .mutation(async (req) => {
            logRequest("user/signOut", req);
            
            if (req.ctx.res) {
                req.ctx.res.setHeader("Set-Cookie", [
                    "lapse-auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; HttpOnly; SameSite=Lax"
                ]);
            }
            return ok({});
        })
});
