import "./env.js";

import type { FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { call, isProcedure, ORPCError, type AnyProcedure } from "@orpc/server";
import { getAllOAuthScopes, type LapseOAuthScope } from "@hackclub/lapse-api";

import { setClientsForTesting } from "@/db.js";
import { setRealizeQueueForTesting } from "@/job.js";
import type { Context } from "@/router.js";
import type { ExternalActor } from "@/ownership.js";
import type * as safe from "@/secrets.js";
import { encryptedS3, publicS3 } from "@/storage.js";

import { FakeDatabase, type FakeDatabaseOptions } from "./fakeDatabase.js";

export const OWNER_ID = "owner0000001";
export const OTHER_ID = "other0000002";
export const ADMIN_ID = "admin0000003";
export const ROOT_ID = "root00000004";

export function user(id: string, permissionLevel: safe.User["permissionLevel"] = "USER"): safe.User {
    return {
        id,
        email: `${id}@lapse.test`,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        permissionLevel,
        handle: id,
        displayName: id,
        profilePictureUrl: "https://lapse.test/pfp.png",
        bio: "",
        slackTitle: null,
        urls: [],
        hackatimeId: "4242",
        slackId: "U0TEST",
        lastHeartbeat: new Date("2025-01-01T00:00:00Z"),
        lastHandleChangeAt: null,
    };
}

const USERS = {
    [OWNER_ID]: user(OWNER_ID),
    [OTHER_ID]: user(OTHER_ID),
    [ADMIN_ID]: user(ADMIN_ID, "ADMIN"),
    [ROOT_ID]: user(ROOT_ID, "ROOT"),
};

/** Every scope a third-party app can be granted. */
export const THIRD_PARTY_SCOPES = getAllOAuthScopes().filter(x => x !== "elevated");

export function userActor(id: keyof typeof USERS, scopes: LapseOAuthScope[]): ExternalActor {
    return { kind: "USER", user: USERS[id], scopes };
}

export function programActor(scopes: LapseOAuthScope[]): ExternalActor {
    return { kind: "PROGRAM", programKey: { id: "9b2c6c0e-6f0a-4d43-9d0a-3f1f6f0e7a11", name: "test key", scopes } };
}

export interface Outcome {
    /** `allowed` if the handler ran; otherwise how the request was turned away. */
    kind: "allowed" | "unauthorized" | "forbidden" | "no-permission";
    output?: unknown;
    error?: unknown;
    database: FakeDatabase;
    /** Requests made to other services (Lookout, Hackatime, Slack). */
    fetches: string[];
}

function fakeRedis(): Redis {
    const store = new Map<string, string>();

    const commands: Record<string, (...args: string[]) => unknown> = {
        get: key => store.get(key!) ?? null,
        set: (key, value, ...flags) => {
            if (flags.includes("NX") && store.has(key!))
                return null;

            store.set(key!, value!);
            return "OK";
        },
        del: key => store.delete(key!) ? 1 : 0,
        exists: key => store.has(key!) ? 1 : 0,
        incr: key => {
            const next = Number(store.get(key!) ?? 0) + 1;
            store.set(key!, String(next));
            return next;
        },
        expire: () => 1,
        eval: () => 0,
    };

    return new Proxy({}, {
        get: (_, command) => async (...args: string[]) => {
            const run = commands[String(command)];
            if (!run)
                throw new Error(`The fake Redis doesn't implement ${String(command)}.`);

            return run(...args);
        },
    }) as Redis;
}

const LOOKOUT_SESSION = {
    session: {
        id: "0c8f6a5e-3f0d-4a6e-9a51-2f0f6f1b7c10",
        name: "untitled-2025-01-01",
        status: "complete",
        metadata: {},
        trackedSeconds: 120,
        videoUrl: "https://lookout.test/video.mp4",
        thumbnailUrl: "https://lookout.test/thumbnail.jpg",
        trackingMode: "screen",
        totalActiveSeconds: 120,
    },
    trackedSeconds: 120,
    screenshotCount: 12,
    clientInfo: "Lookout Desktop/1.0.0",
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Answers for the services the server talks to. Anything unexpected is refused, so a new call site shows up. */
function fakeFetch(fetches: string[]): typeof fetch {
    return async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const method = init?.method ?? "GET";
        fetches.push(`${method} ${url.origin}${url.pathname}`);

        if (url.origin === "https://lookout.test") {
            if (url.pathname === "/api/internal/sessions/batch") {
                const { sessionIds } = JSON.parse(String(init?.body)) as { sessionIds: string[] };
                return json({ sessions: sessionIds.map(id => ({ ...LOOKOUT_SESSION, session: { ...LOOKOUT_SESSION.session, id } })), missing: [] });
            }

            if (url.pathname === "/api/internal/sessions" && method === "POST")
                return json({ token: "lookout-session-token", sessionId: LOOKOUT_SESSION.session.id, sessionUrl: "https://lookout.test/s" });

            if (url.pathname.endsWith("/timings"))
                return json({ status: "complete", count: 2, first: "2025-01-01T00:00:00Z", last: "2025-01-01T00:01:00Z", clientInfo: LOOKOUT_SESSION.clientInfo, timestamps: ["2025-01-01T00:00:00Z", "2025-01-01T00:01:00Z"] });

            if (url.pathname.startsWith("/api/internal/sessions/"))
                return json(method === "GET" ? LOOKOUT_SESSION : {});
        }

        if (url.origin === "https://hackatime.hackclub.com") {
            if (url.pathname.endsWith("/api_keys"))
                return json({ token: "hackatime-api-key" });

            if (url.pathname.endsWith("/projects"))
                return json({ projects: [{ name: "lapse", total_seconds: 120, most_recent_heartbeat: "2025-01-01T00:00:00Z", languages: ["TypeScript"], archived: false }] });

            if (url.pathname.endsWith("/me"))
                return json({ id: 4242, emails: ["owner@lapse.test"], slack_id: "U0TEST", trust_factor: { trust_level: "green", trust_value: 1 } });

            if (url.pathname.endsWith("/heartbeats.bulk"))
                return json({ responses: [[{ time: 0 }, 201]] });
        }

        if (url.origin === "https://hackatime.test" && url.pathname === "/oauth/token")
            return json({ access_token: "hackatime-access-token", token_type: "Bearer", expires_in: 3600, refresh_token: "hackatime-refresh-token" });

        if (url.origin === "https://slack.com")
            return json({ ok: true, user: { profile: { display_name: "Somebody", real_name: "Somebody", title: "", image_512: "https://lapse.test/pfp.png" } } });

        return json({ error: `The fake fetch has no answer for ${method} ${url.href}.` }, 501);
    };
}

export interface RequestOptions {
    database?: Partial<FakeDatabaseOptions>;
    headers?: Record<string, string>;
    context?: Partial<Context>;
}

/**
 * Calls a procedure as `actor`, against a fresh fake database, and reports whether it was let through.
 */
export async function request(procedure: AnyProcedure, input: unknown, actor: ExternalActor | null, options: RequestOptions = {}): Promise<Outcome> {
    const database = new FakeDatabase({ ownerId: OWNER_ID, users: USERS, ...options.database });
    const fetches: string[] = [];
    const realFetch = globalThis.fetch;

    setClientsForTesting({ database: database.client, redis: fakeRedis() });
    globalThis.fetch = fakeFetch(fetches);
    setRealizeQueueForTesting({
        add: async () => ({ id: "job-1" }) as Awaited<ReturnType<Parameters<typeof setRealizeQueueForTesting>[0]["add"]>>,
        remove: async () => 1,
        getJob: async () => undefined,
    });
    encryptedS3.send = async () => ({});
    publicS3.send = async () => ({});

    const headers = { "content-length": "0", ...options.headers };
    const context: Context = {
        req: { url: "/api/test", headers, ip: "127.0.0.1" } as FastifyRequest,
        reqHeaders: new Headers(headers),
        resHeaders: new Headers(),
        actor,
        user: actor?.kind === "USER" ? actor.user : null,
        scopes: actor === null ? [] : actor.kind === "USER" ? actor.scopes : actor.programKey.scopes,
        ...options.context,
    };

    try {
        const output = await call(procedure, input, { context });
        const refused = typeof output === "object" && output !== null && "error" in output && output.error === "NO_PERMISSION";
        return { kind: refused ? "no-permission" : "allowed", output, database, fetches };
    }
    catch (error) {
        if (error instanceof ORPCError && error.code === "UNAUTHORIZED")
            return { kind: "unauthorized", error, database, fetches };

        if (error instanceof ORPCError && error.code === "FORBIDDEN")
            return { kind: "forbidden", error, database, fetches };

        // The handler ran and then failed on its own terms (say, an input the fake world can't satisfy).
        return { kind: "allowed", error, database, fetches };
    }
    finally {
        globalThis.fetch = realFetch;
    }
}

/**
 * Lists every procedure of a router by its dotted path, e.g. `admin.programKey.create`.
 */
export function proceduresOf(router: unknown, path: string[] = []): Map<string, AnyProcedure> {
    if (isProcedure(router))
        return new Map([[path.join("."), router]]);

    // A contract's procedures, which aren't callable but are listed the same way.
    if (typeof router === "object" && router !== null && "~orpc" in router)
        return new Map([[path.join("."), router as AnyProcedure]]);

    const found = new Map<string, AnyProcedure>();
    if (typeof router === "object" && router !== null) {
        for (const [key, value] of Object.entries(router)) {
            for (const [name, procedure] of proceduresOf(value, [...path, key]))
                found.set(name, procedure);
        }
    }

    return found;
}
