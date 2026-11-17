import { z } from "zod";
import { implement } from "@orpc/server";
import { hackatimeRouterContract, type HackatimeProject } from "@hackclub/lapse-api";

import { logMiddleware, requiredAuth, requiredScopes, requiredImplicitUser, type Context } from "@/router.js";
import { dtoOwnedTimelapse, dtoTimelapse, TIMELAPSE_INCLUDES, TIMELAPSE_OMIT } from "@/routers/timelapse.js";
import { apiOk } from "@/common.js";
import { cachedJson, fingerprint } from "@/cache.js";
import { database, redis } from "@/db.js";
import { logError, logWarning } from "@/logging.js";
import { apiErr } from "@/common.js";
import { HackatimeApiError, HackatimeOAuthApi } from "@/hackatime.js";
import { maybe } from "@hackclub/lapse-shared";
import { actorEntitledTo } from "@/ownership.js";

import * as db from "@/generated/prisma/client.js";

/**
 * The user's Hackatime projects, most recently worked on first.
 *
 * Extracted from `allProjects` so the Lookout publish panel can offer the same picker. The panel is
 * authenticated by its own URL rather than by a signed-in user, so it cannot call the procedure.
 */
export async function hackatimeProjectsForUser(user: db.User): Promise<HackatimeProject[]> {
    if (!user.hackatimeId || !user.hackatimeAccessToken)
        return [];

    const token = user.hackatimeAccessToken;

    // The project picker opens on every publish, and Hackatime takes a few hundred milliseconds to answer.
    const projects = await cachedJson(
        `lapse:hackatime:projects:${user.id}:${fingerprint(token)}`,
        HACKATIME_PROJECTS_TTL_SECONDS,
        () => new HackatimeOAuthApi(token).getProjects()
    );

    return projects
        .filter(p => typeof p.name === "string" && p.name.trim().length > 0)
        .sort((a, b) => {
            const aTime = a.most_recent_heartbeat ? new Date(a.most_recent_heartbeat).getTime() : 0;
            const bTime = b.most_recent_heartbeat ? new Date(b.most_recent_heartbeat).getTime() : 0;
            return bTime - aTime;
        })
        .map(p => ({
            name: p.name,
            totalSeconds: p.total_seconds,
            languages: (p.languages ?? []).filter(x => typeof x === "string" && x.trim().length > 0)
        }));
}

/**
 * Whether Hackatime has banned the user (marked them as `red`). Banned users can still sign in, but Hackatime refuses
 * to give us their projects or their API key - so there is nothing to sync with, and signing in again won't change that.
 */
export async function isHackatimeRestricted(user: db.User): Promise<boolean> {
    if (!user.hackatimeId || !user.hackatimeAccessToken)
        return false;

    const token = user.hackatimeAccessToken;
    return await cachedJson(
        `lapse:hackatime:restricted:${user.id}:${fingerprint(token)}`,
        HACKATIME_RESTRICTED_TTL_SECONDS,
        async () => (await new HackatimeOAuthApi(token).me()).trust_factor?.trust_level === "red"
    );
}

const HACKATIME_PROJECTS_TTL_SECONDS = 30;
const HACKATIME_STATUS_TTL_SECONDS = 10 * 60;
/** Shorter, as this gates publishing: a fresh ban should take hold within a couple of minutes. */
const HACKATIME_RESTRICTED_TTL_SECONDS = 2 * 60;

type LinkStatus = { needsRelink: boolean; restricted: boolean };

/**
 * Asks Hackatime whether the user's link still works. `definitive` is `false` when Hackatime itself misbehaved, in
 * which case the answer is only a guess that shouldn't be remembered.
 */
async function checkLinkStatus(userId: string, token: string): Promise<LinkStatus & { definitive: boolean }> {
    const oauthApi = new HackatimeOAuthApi(token);

    try {
        await oauthApi.getProjects();
        return { needsRelink: false, restricted: false, definitive: true };
    }
    catch (error) {
        // 403 is Hackatime refusing a token minted before we asked for `read`; 401 is one that has stopped
        // working altogether. Signing in again fixes both. Anything else is Hackatime's problem, not the
        // user's, and nagging them about it would not help.
        const status = error instanceof HackatimeApiError ? error.status : null;

        if (status !== 401 && status !== 403)
            logError("Couldn't check the Hackatime link status", { error, userId });

        if (status === 403)
            return { needsRelink: true, restricted: false, definitive: true };

        if (status !== 401)
            return { needsRelink: false, restricted: false, definitive: false };

        // Hackatime also answers 401 for banned users. Their token still works for `/me` - so if it does, the
        // token is fine, and signing in again wouldn't change a thing.
        try {
            await oauthApi.me();
            return { needsRelink: false, restricted: true, definitive: true };
        }
        catch (meError) {
            const meStatus = meError instanceof HackatimeApiError ? meError.status : null;

            if (meStatus !== 401)
                logError("Couldn't check whether the user is banned on Hackatime", { error: meError, userId });

            return { needsRelink: meStatus === 401, restricted: false, definitive: meStatus === 401 };
        }
    }
}

const os = implement(hackatimeRouterContract)
    .$context<Context>()
    .use(logMiddleware);

export default os.router({
    allProjects: os.allProjects
        .use(requiredAuth())
        .use(requiredScopes("timelapse:read"))
        .use(requiredImplicitUser())
        .handler(async (req) => {
            const caller = req.context.user;

            if (!caller.hackatimeId || !caller.hackatimeAccessToken)
                return apiErr("ERROR", "You must have a linked Hackatime account!");

            try {
                return apiOk({ projects: await hackatimeProjectsForUser(caller) });
            }
            catch (error) {
                logError("Failed to fetch Hackatime projects", { error, userId: caller.id });
                return apiOk({ projects: [] });
            }
        }),

    linkStatus: os.linkStatus
        .use(requiredAuth())
        .use(requiredScopes("timelapse:read"))
        .use(requiredImplicitUser())
        .handler(async (req) => {
            // The user was loaded fresh for this request while authenticating it.
            const dbUser = req.context.user;

            if (!dbUser.hackatimeId || !dbUser.hackatimeAccessToken)
                return apiOk({ needsRelink: false, restricted: false });

            // Every page load asks this, and the answer only changes when the user signs in again (which changes
            // the token, and with it the key) or Hackatime changes its mind about them.
            const key = `lapse:hackatime:linkStatus:${dbUser.id}:${fingerprint(dbUser.hackatimeAccessToken)}`;

            try {
                const cached = await redis().get(key);
                if (cached !== null)
                    return apiOk(JSON.parse(cached) as LinkStatus);
            }
            catch (error) {
                logWarning("Couldn't read the cached Hackatime link status.", { error });
            }

            const { definitive, ...status } = await checkLinkStatus(dbUser.id, dbUser.hackatimeAccessToken);

            if (definitive) {
                try {
                    await redis().set(key, JSON.stringify(status), "EX", HACKATIME_STATUS_TTL_SECONDS);
                }
                catch (error) {
                    logWarning("Couldn't cache the Hackatime link status.", { error });
                }
            }

            return apiOk(status);
        }),

    myTimelapsesForProject: os.myTimelapsesForProject
        .use(requiredAuth())
        .use(requiredScopes("timelapse:read"))
        .use(requiredImplicitUser())
        .handler(async (req) => {
            const caller = req.context.user;

            const timelapses = await database().timelapse.findMany({
                include: TIMELAPSE_INCLUDES,
                omit: TIMELAPSE_OMIT,
                orderBy: { createdAt: "desc" },
                where: {
                    ownerId: caller.id,
                    hackatimeProject: req.input.projectKey,
                    visibility: { in: ["PUBLIC", "UNLISTED"] }
                }
            });

            return apiOk({
                count: timelapses.length,
                timelapses: timelapses.map(x => dtoOwnedTimelapse(x))
            });
        }),

    timelapsesForProject: os.timelapsesForProject
        .handler(async (req) => {
            const actor = req.context.actor;

            const subject = await database().user.findFirst({
                where: {
                    hackatimeId: req.input.hackatimeUserId.toString()
                }
            });

            if (!subject)
                return apiOk({ count: 0, timelapses: [] });

            const isPrivilidged = (actor != null) && (
                (actor.kind == "PROGRAM" && actor.programKey.scopes.includes("timelapse:read")) ||
                (actor.kind == "USER" && actor.scopes.includes("timelapse:read") && actorEntitledTo({ ownerId: subject.id }, actor))
            );

            const timelapses = await database().timelapse.findMany({
                include: TIMELAPSE_INCLUDES,
                omit: TIMELAPSE_OMIT,
                orderBy: { createdAt: "desc" },
                where: {
                    ownerId: subject.id,
                    hackatimeProject: req.input.projectKey,
                    visibility: {
                        in: [
                            "PUBLIC",
                            ...maybe("UNLISTED" as const, isPrivilidged)
                        ]
                    }
                }
            });

            return apiOk({
                count: timelapses.length,
                timelapses: timelapses.map(x => dtoTimelapse(x, req.context.actor))
            });
        }),
});
