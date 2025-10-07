import { z } from "zod";
import { zx } from "@traversable/zod";

import { procedure, router, protectedProcedure } from "@/server/trpc";
import { apiResult, err, ok } from "@/shared/common";
import * as db from "@/generated/prisma";

const database = new db.PrismaClient();

/**
 * Public-facing user fields.
 */
export type UserProfile = z.infer<typeof UserProfileSchema>;
export const UserProfileSchema = z.object({
    /**
     * The unique handle of the user.
     */
    handle: z.string().min(3).max(16),

    /**
     * The display name of the user. Cannot be blank.
     */
    displayName: z.string().min(1).max(24),

    /**
     * The bio of the user. Maximum of 160 characters.
     */
    bio: z.string().max(160).default(""),

    /**
     * Featured URLs that should be displayed on the user"s page. This array has a maximum of 4 members.
     */
    urls: z.array(z.url().max(64).min(1)).max(4)
});

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
 * Represents fields of a user record that can be modified by said user.
 */
export type UserMutable = z.infer<typeof UserMutableSchema>;
export const UserMutableSchema = z.object({
    profile: UserProfileSchema,
    hackatimeApiKey: z.uuid().optional()
});

/**
 * Represents a device that belongs to a user, which contains a private passkey. Passkeys are not
 */
export type KnownDevice = z.infer<typeof KnownDeviceSchema>;
export const KnownDeviceSchema = z.object({
    /**
     * The ID of the device.
     */
    id: z.string(),

    /**
     * A user-defined name for the device.
     */
    name: z.string()
});

/**
 * Represents a full user, *including* private fields.
 */
export type User = z.infer<typeof UserSchema>;
export const UserSchema = z.object({
    id: z.uuid(),
    createdAt: z.number().nonnegative(),
    permissionLevel: PermissionLevelSchema,
    mutable: UserMutableSchema,
    devices: z.array(KnownDeviceSchema)
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
export function dtoUser(entity: DbCompositeUser): User {
    return {
        id: entity.id,
        createdAt: entity.createdAt.getTime(),
        permissionLevel: entity.permissionLevel,
        devices: entity.devices.map(dtoKnownDevice),
        mutable: {
            hackatimeApiKey: entity.hackatimeApiKey ?? undefined,
            profile: {
                displayName: entity.displayName,
                bio: entity.bio,
                handle: entity.handle,
                urls: entity.urls
            }
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
            if (!req.ctx.user)
                return ok({ user: null });

            const user = await database.user.findFirst({
                include: { devices: true },
                where: { id: req.ctx.user.id }
            });

            if (!user)
                return err("Could not find your user account.");

            return ok({ user: dtoUser(user) });
        }),

    /**
     * Finds a profile by its handle *or* ID.
     */
    query: procedure
        .input(
            z.object({
                /**
                 * The UUID of the profile to query. Can be undefined if `handle` is specified.
                 */
                id: z.uuid().optional(),

                /**
                 * The handle of the profile to query. Can be undefined if `id` is specified.
                 */
                handle: z.string().optional()
            })
        )
        .output(
            apiResult({
                user: UserProfileSchema.optional()
            })
        )
        .query(async (req) => {
            if (!req.input.handle && !req.input.id)
                return err("No handle or user ID specified"); 

            let dbUser: DbCompositeUser | null;

            if (req.input.handle) {
                dbUser = await database.user.findFirst({
                    where: { handle: req.input.handle },
                    include: { devices: true }
                });
            }
            else {
                dbUser = await database.user.findFirst({
                    where: { id: req.input.id },
                    include: { devices: true }
                });
            }

            if (!dbUser)
                return ok({ user: undefined });
            
            return ok({ user: dtoUser(dbUser).mutable.profile });
        }),

    /**
     * Updates user profile information.
     */
    update: protectedProcedure
        .input(
            z.object({
                /**
                 * The ID of the target user to edit. If the calling user has their permissionLevel set to "USER",
                 * this field can only be set to their ID.
                 */
                id: z.uuid(),

                /**
                 * The changes to apply to the user profile.
                 */
                changes: zx.deepPartial(UserMutableSchema)
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
            // Check if user can edit this profile
            if (req.ctx.user.permissionLevel === "USER" && req.ctx.user.id !== req.input.id)
                return err("You can only edit your own profile");

            // Prepare update data
            const updateData: Partial<db.User> = {};
            
            if (req.input.changes.profile) {
                const { profile } = req.input.changes;
                if (profile.displayName) {
                    updateData.displayName = profile.displayName;
                }

                if (profile.bio !== undefined) {
                    updateData.bio = profile.bio;
                }

                if (profile.handle) {
                    updateData.handle = profile.handle;
                }

                if (profile.urls) {
                    updateData.urls = profile.urls;
                }
            }
            
            if (req.input.changes.hackatimeApiKey !== undefined) {
                updateData.hackatimeApiKey = req.input.changes.hackatimeApiKey;
            }

            const updatedUser = await database.user.update({
                where: { id: req.input.id },
                data: updateData,
                include: { devices: true }
            });

            return ok({ user: dtoUser(updatedUser) });
        }),

    /**
     * Creates a new device owned by their user, allocating a new, unique ID.
     */
    registerDevice: protectedProcedure
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
            const device = await database.knownDevice.create({
                data: {
                    name: req.input.name,
                    ownerId: req.ctx.user.id
                }
            });

            return ok({ device: dtoKnownDevice(device) });
        })
});
