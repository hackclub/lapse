import { implement } from "@orpc/server"
import { deleteCookie } from "@orpc/server/helpers"
import { userRouterContract, type KnownDevice, type PublicUser, type User } from "@hackclub/lapse-api"
import { assert, when, descending } from "@hackclub/lapse-shared"

import { type Context, logMiddleware, requiredAuth } from "@/router.js";
import { apiErr, apiOk } from "@/common.js";
import { database } from "@/db.js";
import { logError } from "@/logging.js";

import * as db from "@/generated/prisma/client.js";
import { deleteTimelapse } from "@/routers/timelapse.js";

const os = implement(userRouterContract)
    .$context<Context>()
    .use(logMiddleware);

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

export default os.router({
    myself: os.myself
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const user = await database.user.findFirst({
                include: { devices: true },
                where: { id: caller.id }
            });

            if (!user)
                return apiErr("NOT_FOUND", "Could not find your user account.");

            return apiOk({ user: dtoUser(user) });
        }),

    query: os.query
        .handler(async (req) => {
            const caller = req.context.user;
            
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
            const user: User | PublicUser = caller?.id == dbUser.id
                ? dtoUser(dbUser)
                : dtoPublicUser(dbUser);
            
            return apiOk({ user });
        }),

    update: os.update
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            // Check if user can edit this profile
            if (caller.permissionLevel === "USER" && caller.id !== req.input.id)
                return apiErr("NO_PERMISSION", "You can only edit your own profile");

            const changes = req.input.changes;
            const updateData: Partial<db.User> = {
                ...when(changes.displayName !== undefined, { displayName: changes.displayName! }),
                ...when(changes.bio !== undefined, { bio: changes.bio! }),
                ...when(changes.handle !== undefined, { handle: changes.handle! }),
                ...when(changes.urls !== undefined, { urls: changes.urls! })
            };

            const updatedUser = await database.user.update({
                where: { id: req.input.id },
                data: updateData,
                include: { devices: true }
            });

            return apiOk({ user: dtoUser(updatedUser) });
        }),

    getDevices: os.getDevices
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;
            
            const devices = await database.knownDevice.findMany({
                where: { ownerId: caller.id }
            });

            return apiOk({ devices: devices.map(dtoKnownDevice) });
        }),

    registerDevice: os.registerDevice
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;
            
            const device = await database.knownDevice.create({
                data: {
                    name: req.input.name,
                    ownerId: caller.id
                }
            });

            return apiOk({ device: dtoKnownDevice(device) });
        }),

    removeDevice: os.removeDevice
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;
            
            const device = await database.knownDevice.findFirst({
                where: { id: req.input.id, ownerId: caller.id }
            });

            if (!device)
                return apiErr("DEVICE_NOT_FOUND", "That device doesn't seem to exist!");

            const timelapses = await database.timelapse.findMany({
                where: { deviceId: device.id }
            });

            if (timelapses.some(x => x.ownerId != caller.id)) {
                logError("user.removeDevice", "A timelapse has a device that is not owned by the author!", { ownerId: caller.id, timelapses });
                return apiErr("ERROR", "That device seems to be used by another user! Please report this to @ascpixi on Slack.");
            }

            await Promise.all(
                timelapses.map(async (timelapse) => {
                    await deleteTimelapse(timelapse.id, caller);
                })
            );

            await database.knownDevice.delete({
                where: { id: req.input.id, ownerId: caller.id }
            });

            return apiOk({});
        }),

    signOut: os.signOut
        .handler(async (req) => {
            if (req.context.resHeaders) {
                deleteCookie(req.context.resHeaders, "lapse-auth", {
                    httpOnly: true,
                    sameSite: "lax"
                });
            }

            return apiOk({});
        }),

    hackatimeProjects: os.hackatimeProjects
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const projects = new Map<string, number>();
            const timelapses = await database.timelapse.findMany({
                select: {
                    hackatimeProject: true,
                    duration: true
                },
                where: {
                    ownerId: caller.id,
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

    getTotalTimelapseTime: os.getTotalTimelapseTime
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            if (!req.input.id && !caller)
                return apiErr("MISSING_PARAMS", "'id' is required when not authenticated.");
            
            const aggregate = await database.timelapse.aggregate({
                _sum: { duration: true },
                where: { ownerId: req.input.id ?? caller.id }
            });

            return apiOk({ time: aggregate._sum.duration ?? 0 });
        }),

    emitHeartbeat: os.emitHeartbeat
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            await database.user.update({
                data: { lastHeartbeat: new Date() },
                where: { id: caller.id }
            });

            return apiOk({});
        })
});
