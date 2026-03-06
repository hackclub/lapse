import { z } from "zod";
import { raise } from "@hackclub/lapse-shared";

import { LapseId, LapseDate, apiResult } from "@/common";
import { contract, NO_INPUT, NO_OUTPUT } from "@/internal";

/**
 * Represents the permission level of a user.
 */
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;
export const PermissionLevelSchema = z.enum([
    "USER",  // normal permissions
    "ADMIN", // same as "USER", but adds the ability to remove and review projects
    "ROOT", // same as "ADMIN", but adds the ability to change the permissions of non-owners, alongside full project editing permissions
]);

export function permissionLevelOrdinal(level: PermissionLevel) {
    return (
        level == "USER" ? 0 :
        level == "ADMIN" ? 1 :
        level == "ROOT" ? 2 :
        raise(new Error(`'${level}' is not a valid permission level.`))
    );
}

/**
 * Represents a device that belongs to a user, which contains a private passkey. Passkeys are always stored only on the client - never on the server.
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
 * The minimum length for a user handle.
 */
export const MIN_HANDLE_LENGTH = 3;

/**
 * The maximum length for a user handle.
 */
export const MAX_HANDLE_LENGTH = 16;

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
    id: LapseId,

    /**
     * The date when the user created their account.
     */
    createdAt: LapseDate,

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

export const userRouterContract = {
    myself: contract("GET", "/user/myself")
        .route({ description: "Gets the information about the calling user. If the caller is not authenticated, returns `null` as the `user`." })
        .input(NO_INPUT)
        .output(
            apiResult({
                user: UserSchema.nullable()
            })
        ),

    query: contract("GET", "/user/query")
        .route({ description: "Finds a profile by its handle, ID, or Hackatime ID." })
        .input(
            z.object({
                id: LapseId.optional()
                    .describe("The ID of the profile to query. Can be undefined if another field is specified."),

                handle: UserHandle.optional()
                    .describe("The handle of the profile to query. Can be undefined if another field is specified."),

                hackatimeId: z.number().min(1).optional()
                    .describe("The Hackatime ID of the profile to query. Can be undefined if another field is specified."),
            })
        )
        .output(
            apiResult({
                user: z.union([UserSchema, PublicUserSchema]).nullable()
            })
        ),

    update: contract("PATCH", "/user/update")
        .route({ description: "Updates user profile information." })
        .input(
            z.object({
                id: LapseId
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
        ),

    getDevices: contract("GET", "/user/getDevices")
        .route({ description: "Gets all devices registered by the currently authenticated user." })
        .input(NO_INPUT)
        .output(
            apiResult({
                devices: z.array(KnownDeviceSchema)
            })
        ),

    registerDevice: contract("POST", "/user/registerDevice")
        .route({ description: "Creates a new device owned by a user, allocating a new, unique ID." })
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
        ),

    removeDevice: contract("DELETE", "/user/removeDevice")
        .route({ description: "Removes a device owned by a user." })
        .input(
            z.object({
                id: LapseId
                    .describe("The ID of the device to remove. The device must be owned by the calling user.") 
            })
        )
        .output(NO_OUTPUT),

    signOut: contract("POST", "/user/signOut")
        .route({ description: "Signs out the current user by clearing the authentication cookie." })
        .input(NO_INPUT)
        .output(NO_OUTPUT),

    hackatimeProjects: contract("GET", "/user/hackatimeProjects")
        .route({ description: "Gets a list of Hackatime projects that have been associated with the user's timelapses, including the total hour counts." })
        .input(NO_INPUT)
        .output(
            apiResult({
                projects: z.array(
                    z.object({
                        name: z.string().min(1)
                            .describe("The name of the project."),

                        time: z.number().nonnegative()
                            .describe("The amount of time spent timelapsing.")
                    })
                )
                    .describe("All of the Hackatime projects associated with timelapses.")
            })
        ),

    getTotalTimelapseTime: contract("GET", "/user/getTotalTimelapseTime")
        .route({ description: "Queries the aggregate duration of all timelapses of a given user." })
        .input(
            z.object({
                id: LapseId.nullable()
                    .describe("The ID of the user to query the total timelapse time of. If `null`, and the user is authenticated, the user's ID is used instead.")
            })
        )
        .output(
            apiResult({
                time: z.number().nonnegative()
                    .describe("The aggregate duration of all timelapses of the queried user.")
            })
        ),

    emitHeartbeat: contract("POST", "/user/emitHeartbeat")
        .route({ description: "Updates the last heartbeat time of the calling user to the current date. This is used to detect active users." })
        .input(NO_INPUT)
        .output(NO_OUTPUT)
};
