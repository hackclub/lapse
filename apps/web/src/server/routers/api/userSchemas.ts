import { z } from "zod";

import { ApiDate, PublicId } from "@/server/routers/common";

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

/**
 * The minimum length of a user handle.
 */
export const MIN_HANDLE_LENGTH = 3;

/**
 * The maximum length of a user handle.
 */
export const MAX_HANDLE_LENGTH = 16;

export const UserHandle = z.string().min(MIN_HANDLE_LENGTH).max(MAX_HANDLE_LENGTH);
export const UserDisplayName = z.string().min(1).max(24);
export const UserBio = z.string().max(160).default("");
export const UserUrlList = z.array(z.url().max(64).min(1)).max(4); 

/**
 * Represents ban information fetched from the latest BanRecord.
 */
export type BanInfo = z.infer<typeof BanInfoSchema>;
export const BanInfoSchema = z.object({
    /**
     * The date when the user was banned.
     */
    bannedAt: ApiDate,

    /**
     * The public reason provided by an administrator for the ban (shown to user).
     */
    reason: z.string(),

    /**
     * The internal reason for the ban (only visible to admins).
     */
    reasonInternal: z.string()
});

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
    needsReauth: z.boolean(),

    /**
     * Ban information if the user is banned, or `null` if not banned.
     */
    ban: BanInfoSchema.nullable()
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
 * Represents a ban action type.
 */
export type BanAction = z.infer<typeof BanActionSchema>;
export const BanActionSchema = z.enum(["BAN", "UNBAN"]);

/**
 * Represents a record of a ban or unban action.
 */
export type BanRecord = z.infer<typeof BanRecordSchema>;
export const BanRecordSchema = z.object({
    id: PublicId,
    createdAt: ApiDate,
    action: BanActionSchema,
    reason: z.string(),
    reasonInternal: z.string(),
    performedBy: z.object({
        id: PublicId,
        handle: UserHandle,
        displayName: UserDisplayName
    })
});

/**
 * Represents a `db.BanRecord` with related tables included.
 */
export type DbBanRecord = db.BanRecord & { performedBy: db.User };

/**
 * Converts a database representation of a ban record to a runtime (API) one.
 */
export function dtoBanRecord(entity: DbBanRecord): BanRecord {
    return {
        id: entity.id,
        createdAt: entity.createdAt.getTime(),
        action: entity.action,
        reason: entity.reason,
        reasonInternal: entity.reasonInternal,
        performedBy: {
            id: entity.performedBy.id,
            handle: entity.performedBy.handle,
            displayName: entity.performedBy.displayName
        }
    };
}

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
