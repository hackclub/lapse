import { implement } from "@orpc/server"
import { userRouterContract, type KnownDevice, type PublicUser, type User, HANDLE_CHANGE_COOLDOWN_MS, MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH } from "@hackclub/lapse-api"
import { assert, when, descending, removeFromArray } from "@hackclub/lapse-shared"

import { type Context, logMiddleware } from "@/router.js";
import { authorize } from "@/policies.js";
import { apiErr, apiOk } from "@/common.js";
import { database } from "@/db.js";
import { logError } from "@/logging.js";
import { actorEntitledTo } from "@/ownership.js";
import { renewSessionCookie, revokeAccessToken } from "@/oauth.js";
import { clearSessionCookie, sessionCookieOf } from "@/session.js";

import * as db from "@/generated/prisma/client.js";
import { deleteDraftTimelapse } from "@/routers/draftTimelapse.js";
import type * as safe from "@/secrets.js";

/**
 * The TTL for keys being stored in `keysPendingRelay`, in milliseconds. After this time, keys will be automatically removed.
 */
const KEY_RELAY_TTL_MS = 5 * 60 * 1000; // 5min

const keyExchanges: KeyExchange[] = [];
interface KeyExchange {
    id: string; // unique ID for this exchange
    key: string | null;
    targetDevice: string; // the device that requestingDevice wants the key from
    requestingDevice: string; // the device that initiated this exchange
    userId: string; // the user that this exchange concerns
};

const os = implement(userRouterContract)
    .$context<Context>()
    .use(logMiddleware);

/**
 * Represents a `safe.User` with related tables included.
 */
export type DbCompositeUser = safe.User & { devices: db.KnownDevice[] };

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
export function dtoPublicUser(entity: safe.User): PublicUser {
    return {
        id: entity.id,
        createdAt: entity.createdAt.getTime(),
        // Clamp display name and bio to the contract maximums on read: legacy rows can hold longer values
        // (e.g. a Slack display name or profile title copied in at signup before truncation existed). An
        // over-long value fails output validation and 500s every request that returns this user, locking
        // them out entirely - so we defensively truncate here. `|| "User"` guards the `min(1)` on an empty name.
        displayName: entity.displayName.slice(0, MAX_DISPLAY_NAME_LENGTH) || "User",
        profilePictureUrl: entity.profilePictureUrl,
        bio: entity.bio.slice(0, MAX_BIO_LENGTH),
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
        .use(authorize("user.myself"))
        .handler(async (req) => {
            const caller = req.context.user;

            if (!caller)
                return apiOk({ user: null });

            const user = await database().user.findFirst({
                include: { devices: true },
                where: { id: caller.id }
            });

            if (!user)
                return apiErr("NOT_FOUND", "Could not find your user account.");

            // Every page load asks who is signed in, which makes this the place to keep the session cookie fresh:
            // Safari forgets some cookies a week after they were last set, however long they say they live for.
            const session = sessionCookieOf(req.context.req);
            if (session)
                renewSessionCookie(req.context.resHeaders, session);

            return apiOk({ user: dtoUser(user) });
        }),

    query: os.query
        .use(authorize("user.query"))
        .handler(async (req) => {
            const caller = req.context.user;
            
            let dbUser: DbCompositeUser | null;

            if (req.input.handle) {
                dbUser = await database().user.findFirst({
                    where: { handle: req.input.handle.trim() },
                    include: { devices: true }
                });
            }
            else if (req.input.id) {
                dbUser = await database().user.findFirst({
                    where: { id: req.input.id },
                    include: { devices: true }
                });
            }
            else if (req.input.hackatimeId) {
                dbUser = await database().user.findFirst({
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

    queryByEmail: os.queryByEmail
        .use(authorize("user.queryByEmail"))
        .handler(async (req) => {
            const user = await database().user.findFirst({
                where: { email: req.input.email }
            });

            if (!user)
                return apiOk({ user: null });

            return apiOk({ user: dtoPublicUser(user) });
        }),

    update: os.update
        .use(authorize("user.update"))
        .handler(async (req) => {
            const user = await database().user.findFirst({
                where: { id: req.input.id }
            });

            if (!user)
                return apiErr("NOT_FOUND", "The given user could not be found.");

            if (req.input.changes.handle !== undefined) {
                if (user.lastHandleChangeAt) {
                    const timeSinceLastChange = Date.now() - user.lastHandleChangeAt.getTime();
                    if (timeSinceLastChange < HANDLE_CHANGE_COOLDOWN_MS) {
                        return apiErr("ERROR", `You can change your handle again in ${Math.ceil((HANDLE_CHANGE_COOLDOWN_MS - timeSinceLastChange) / (60 * 60 * 1000))} hours`);
                    }
                }
            }

            const changes = req.input.changes;
            const updateData: Partial<safe.User> = {
                ...when(changes.displayName !== undefined, { displayName: changes.displayName! }),
                ...when(changes.bio !== undefined, { bio: changes.bio! }),
                ...when(changes.handle !== undefined, { handle: changes.handle!, lastHandleChangeAt: new Date() }),
                ...when(changes.urls !== undefined, { urls: changes.urls! })
            };

            const updatedUser = await database().user.update({
                where: { id: req.input.id },
                data: updateData,
                include: { devices: true }
            });

            return apiOk({ user: dtoUser(updatedUser) });
        }),

    getDevices: os.getDevices
        .use(authorize("user.getDevices"))
        .handler(async (req) => {
            const caller = req.context.user;
            
            const devices = await database().knownDevice.findMany({
                where: { ownerId: caller.id }
            });

            return apiOk({ devices: devices.map(dtoKnownDevice) });
        }),

    registerDevice: os.registerDevice
        .use(authorize("user.registerDevice"))
        .handler(async (req) => {
            const caller = req.context.user;
            
            const device = await database().knownDevice.create({
                data: {
                    name: req.input.name,
                    ownerId: caller.id
                }
            });

            return apiOk({ device: dtoKnownDevice(device) });
        }),

    removeDevice: os.removeDevice
        .use(authorize("user.removeDevice"))
        .handler(async (req) => {
            const caller = req.context.user;
            
            const device = await database().knownDevice.findFirst({
                where: { id: req.input.id, ownerId: caller.id }
            });

            if (!device)
                return apiErr("DEVICE_NOT_FOUND", "That device doesn't seem to exist!");

            // A consequence of removing a device is the permanent loss of all draft timelapses that are associated with that device that haven't been published - we
            // lose the device key alongside the device, and such, we can never decrypt the draft.
            const drafts = await database().draftTimelapse.findMany({
                where: { deviceId: device.id }
            });

            if (drafts.some(x => x.ownerId != caller.id)) {
                logError("A draft timelapse has a device that is not owned by the author!", { ownerId: caller.id, drafts });
                return apiErr("ERROR", "That device seems to be used by another user! Please report this to @ascpixi on Slack.");
            }

            await Promise.all(
                drafts.map(async (timelapse) => {
                    await deleteDraftTimelapse(timelapse.id, req.context.actor);
                })
            );

            await database().knownDevice.delete({
                where: { id: req.input.id, ownerId: caller.id }
            });

            return apiOk({});
        }),

    signOut: os.signOut
        .use(authorize("user.signOut"))
        .handler(async (req) => {
            const authorization = req.context.req.headers.authorization;
            const session = sessionCookieOf(req.context.req);

            // Both, if a request carries both: a tab from before the session moved into the cookie can.
            const tokens = [
                ...(authorization?.startsWith("Bearer ") ? [authorization.substring("Bearer ".length)] : []),
                ...(session ? [session] : [])
            ];

            try {
                for (const token of tokens)
                    await revokeAccessToken(token);
            }
            catch (error) {
                logError("Could not revoke the caller's access token!", { error });
                return apiErr("ERROR", "We couldn't sign you out right now. Please try again in a moment.");
            }

            clearSessionCookie(req.context.resHeaders);

            return apiOk({});
        }),

    hackatimeProjects: os.hackatimeProjects
        .use(authorize("user.hackatimeProjects"))
        .handler(async (req) => {
            const caller = req.context.user;

            const projects = new Map<string, number>();
            const timelapses = await database().timelapse.findMany({
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
        .use(authorize("user.getTotalTimelapseTime"))
        .handler(async (req) => {
            const caller = req.context.user;

            const ownerId = req.input.id ?? caller.id;
            const isEntitled = actorEntitledTo({ ownerId }, req.context.actor);

            const aggregate = await database().timelapse.aggregate({
                _sum: { duration: true },
                where: {
                    ownerId,
                    visibility: isEntitled ? undefined : "PUBLIC",
                    associatedJobId: isEntitled ? undefined : null
                }
            });

            return apiOk({ time: aggregate._sum.duration ?? 0 });
        }),

    emitHeartbeat: os.emitHeartbeat
        .use(authorize("user.emitHeartbeat"))
        .handler(async (req) => {
            const caller = req.context.user;

            await database().user.update({
                data: { lastHeartbeat: new Date() },
                where: { id: caller.id }
            });

            return apiOk({});
        }),

    requestKeyRelay: os.requestKeyRelay
        .use(authorize("user.requestKeyRelay"))
        .handler(async (req) => {
            const caller = req.context.user;

            const callingDevice = await database().knownDevice.findFirst({
                where: { id: req.input.callingDevice }
            });

            if (!callingDevice || callingDevice.ownerId != caller.id)
                return apiErr("DEVICE_NOT_FOUND", "The calling device hasn't been registered or doesn't exist.");

            const targetDevice = await database().knownDevice.findFirst({
                where: { id: req.input.targetDevice }
            });

            if (!targetDevice || targetDevice.ownerId != caller.id)
                return apiErr("DEVICE_NOT_FOUND", "Could not find a registered device with that ID.");

            const id = crypto.randomUUID();

            keyExchanges.push({
                id,
                key: null,
                requestingDevice: req.input.callingDevice,
                targetDevice: req.input.targetDevice,
                userId: caller.id
            });

            setTimeout(
                () => removeFromArray(keyExchanges, x => x.id == id),
                KEY_RELAY_TTL_MS
            );

            return apiOk({ exchangeId: id });
        }),

    queryKeyRelayRequest: os.queryKeyRelayRequest
        .use(authorize("user.queryKeyRelayRequest"))
        .handler(async (req) => {
            const caller = req.context.user;

            const device = await database().knownDevice.findFirst({
                where: { id: req.input.callingDevice }
            });

            if (!device || device.ownerId != caller.id)
                return apiErr("DEVICE_NOT_FOUND", "The calling device hasn't been registered or doesn't exist.");

            const exchange = keyExchanges.find(x => x.targetDevice == req.input.callingDevice && !x.key && x.userId == caller.id);
            if (exchange) {
                return apiOk({
                    request: {
                        exchangeId: exchange.id,
                        callingDevice: exchange.requestingDevice
                    }
                });
            }

            return apiOk({ request: null });
        }),

    provideKeyRelay: os.provideKeyRelay
        .use(authorize("user.provideKeyRelay"))
        .handler(async (req) => {
            const caller = req.context.user;

            const idx = keyExchanges.findIndex(x => x.id == req.input.exchangeId);
            if (idx === -1)
                return apiErr("ERROR", `Could not find key relay exchange with ID ${req.input.exchangeId}.`);

            if (keyExchanges[idx].userId != caller.id)
                return apiErr("ERROR", `Key exchange with ID ${req.input.exchangeId} does not concern the caller.`);

            keyExchanges[idx].key = req.input.deviceKey;
            return apiOk({});
        }),

    denyKeyRelay: os.denyKeyRelay
        .use(authorize("user.denyKeyRelay"))
        .handler(async (req) => {
            const caller = req.context.user;

            const exchange = keyExchanges.find(x => x.id == req.input.exchangeId);
            if (!exchange || exchange.userId != caller.id)
                return apiErr("ERROR", `Could not find the key relay exchange with ID ${req.input.exchangeId}.`);

            removeFromArray(keyExchanges, x => x.id == exchange.id);
            return apiOk({});
        }),

    receiveKeyRelay: os.receiveKeyRelay
        .use(authorize("user.receiveKeyRelay"))
        .handler(async (req) => {
            const caller = req.context.user;

            const exchange = keyExchanges.find(x => x.id == req.input.exchangeId);
            if (!exchange || exchange.userId != caller.id)
                return apiErr("ERROR", `Could not find the key relay exchange with ID ${req.input.exchangeId}.`);

            if (!exchange.key)
                return apiOk({ relay: null }); // the key has not yet been relayed - the caller will probably wait and call this endpoint again after some short period of time

            removeFromArray(keyExchanges, x => x.id == exchange.id);
            return apiOk({
                relay: {
                    deviceId: exchange.targetDevice,
                    deviceKey: exchange.key
                }
            });
        })
});
