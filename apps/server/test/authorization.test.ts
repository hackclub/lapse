import "./support/env.js";

import assert from "node:assert/strict";
import test from "node:test";
import { implement } from "@orpc/server";
import { compositeRouterContract, type ProgramKeyAdminScope } from "@hackclub/lapse-api";

import { assertEveryProcedureIsAuthorized, router } from "@/appRouter.js";
import { getAuthenticatedUser, hashServiceSecret } from "@/oauth.js";
import type { ExternalActor } from "@/ownership.js";
import { POLICIES } from "@/policies.js";
import { setClientsForTesting } from "@/db.js";
import type { Context } from "@/router.js";

import { CANONICAL_CLIENT_ID } from "./support/env.js";
import { FakeDatabase, secretValue, type FakeDatabaseOptions } from "./support/fakeDatabase.js";
import { INPUTS } from "./support/inputs.js";
import { ADMIN_ID, OTHER_ID, OWNER_ID, proceduresOf, programActor, request, ROOT_ID, THIRD_PARTY_SCOPES, userActor, type Outcome } from "./support/world.js";

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);

/**
 * Everyone who might call the API. Every row in the fake database belongs to the owner, so "other", "admin" and
 * "root" are always acting on somebody else's things.
 */
const CALLERS = {
    "nobody": null,
    "the owner, on the website": userActor(OWNER_ID, ["elevated"]),
    "the owner, through an app with every scope": userActor(OWNER_ID, THIRD_PARTY_SCOPES),
    "the owner, through an app with no scopes": userActor(OWNER_ID, []),
    "another user, on the website": userActor(OTHER_ID, ["elevated"]),
    "another user, through an app with every scope": userActor(OTHER_ID, THIRD_PARTY_SCOPES),
    "an admin, through an app with every scope": userActor(ADMIN_ID, THIRD_PARTY_SCOPES),
    "an admin, on the website": userActor(ADMIN_ID, ["elevated"]),
    "ROOT, through an app with every scope": userActor(ROOT_ID, THIRD_PARTY_SCOPES),
    "ROOT, on the website": userActor(ROOT_ID, ["elevated"]),
    "an admin, on the website, who signed in yesterday": userActor(ADMIN_ID, ["elevated"], YESTERDAY),
    "ROOT, on the website, who signed in yesterday": userActor(ROOT_ID, ["elevated"], YESTERDAY),
    "the owner, on the website, who signed in yesterday": userActor(OWNER_ID, ["elevated"], YESTERDAY),
    "a program key with every ordinary scope": programActor(THIRD_PARTY_SCOPES),
    "a program key with no scopes": programActor([]),
    "a program key with every scope, admin:read and admin:write": programActor([...THIRD_PARTY_SCOPES, "admin:read", "admin:write"]),
    "a program key with only the admin scopes": programActor(["admin:read", "admin:write", "admin:panel"]),
    "a program key with every scope there is": programActor([...THIRD_PARTY_SCOPES, "admin:read", "admin:write", "admin:panel"]),
} satisfies Record<string, ExternalActor | null>;

type Scope = (typeof THIRD_PARTY_SCOPES)[number];

/**
 * Who each procedure is for, written out by hand and deliberately apart from `policies.ts`: the two have to agree,
 * so loosening a policy without also changing what is expected of it here fails the tests.
 */
type Expectation =
    /** Anyone at all, signed in or not. */
    | { for: "anyone" }
    /** Any signed-in user acting as themselves. Never a program key. */
    | { for: "users"; scopes: Scope[] }
    /** A user on the Lapse website itself. Never a third-party app, never a program key. */
    | { for: "website" }
    /**
     * Whoever owns the thing being acted on. `admins` says who else may: administrators (on the website only), ROOT
     * for the canonical OAuth client only, or nobody. `program` is the admin scope that lets a program key in.
     */
    | { for: "owner"; scopes: Scope[]; websiteOnly?: true; admins: "ADMIN" | "ROOT, for the canonical app" | "nobody"; program: ProgramKeyAdminScope | "never" }
    /** Administrators at this level on the website, and program keys holding the admin scope. */
    | { for: "admins"; level: "ADMIN" | "ROOT"; scopes?: Scope[]; program: ProgramKeyAdminScope | "never" };

const anyone: Expectation = { for: "anyone" };
const users = (...scopes: Scope[]): Expectation => ({ for: "users", scopes });
const website: Expectation = { for: "website" };
const owner = (scope: Scope, program: ProgramKeyAdminScope | "never"): Expectation => ({ for: "owner", scopes: [scope], admins: "ADMIN", program });
const appOwner = (admins: "ADMIN" | "ROOT, for the canonical app"): Expectation => ({ for: "owner", scopes: [], websiteOnly: true, admins, program: "never" });
const panel: Expectation = { for: "admins", level: "ADMIN", program: "admin:panel" };
const adminsOnly: Expectation = { for: "admins", level: "ADMIN", program: "never" };
const rootOnly: Expectation = { for: "admins", level: "ROOT", program: "never" };

const EXPECTED: Record<string, Expectation> = {
    "user.myself": anyone,
    "user.query": anyone,
    "user.queryByEmail": { for: "admins", level: "ADMIN", scopes: ["user:read"], program: "admin:read" },
    "user.update": owner("user:write", "admin:write"),
    "user.getDevices": users("user:read"),
    "user.registerDevice": users("user:write"),
    "user.removeDevice": users("user:write"),
    "user.signOut": anyone,
    "user.hackatimeProjects": users("user:read"),
    "user.getTotalTimelapseTime": users("timelapse:read"),
    "user.emitHeartbeat": users("user:write"),
    "user.requestKeyRelay": users("user:keyrelay"),
    "user.queryKeyRelayRequest": users("user:keyrelay"),
    "user.provideKeyRelay": users("user:keyrelay"),
    "user.denyKeyRelay": users("user:keyrelay"),
    "user.receiveKeyRelay": users("user:keyrelay"),

    "timelapse.query": anyone,
    "timelapse.publish": users("timelapse:write"),
    "timelapse.update": owner("timelapse:write", "admin:write"),
    "timelapse.delete": owner("timelapse:write", "admin:write"),
    "timelapse.findByUser": anyone,
    "timelapse.listChanged": { for: "admins", level: "ADMIN", scopes: ["timelapse:read"], program: "admin:read" },
    "timelapse.myPublishedTimelapses": users("timelapse:read"),
    "timelapse.syncWithHackatime": users("timelapse:write"),
    "timelapse.approveDesktopPairing": website,
    "timelapse.listDesktopDevices": users("timelapse:read"),
    "timelapse.revokeDesktopDevice": users("timelapse:write"),
    "timelapse.assignBrowserLabelVariant": users("timelapse:write"),
    "timelapse.assignBrowserWarningVariant": users("timelapse:write"),
    "timelapse.getRecordingAvailability": users("timelapse:read"),
    "timelapse.createRecordingSession": users("timelapse:write"),
    "timelapse.getLookoutDrafts": users("timelapse:read"),
    "timelapse.discardLookoutDraft": users("timelapse:write"),
    "timelapse.getArchivedLookoutDrafts": users("timelapse:read"),
    "timelapse.restoreLookoutDraft": users("timelapse:write"),
    "timelapse.pollLookoutStatus": users("timelapse:read"),
    "timelapse.publishFromLookout": users("timelapse:write"),

    "draftTimelapse.query": owner("timelapse:read", "admin:read"),
    "draftTimelapse.findByUser": owner("timelapse:read", "admin:read"),
    "draftTimelapse.create": users("timelapse:write"),
    "draftTimelapse.update": owner("timelapse:write", "admin:write"),
    "draftTimelapse.delete": owner("timelapse:write", "admin:write"),
    "draftTimelapse.legacy": users("timelapse:read"),
    "draftTimelapse.markAsMigrated": owner("timelapse:write", "never"),

    "comment.create": users("comment:write"),
    "comment.delete": owner("comment:write", "admin:write"),

    "developer.rotateAppSecret": appOwner("ROOT, for the canonical app"),
    "developer.updateApp": appOwner("ADMIN"),
    "developer.revokeApp": appOwner("ROOT, for the canonical app"),
    "developer.getAllOwnedApps": website,
    "developer.createApp": website,
    "developer.getAllApps": panel,
    "developer.updateAppTrustLevel": adminsOnly,
    "developer.getOwnedOAuthGrants": website,
    "developer.revokeOAuthGrant": { for: "owner", scopes: [], websiteOnly: true, admins: "nobody", program: "never" },
    "developer.getAppByClientId": anyone,

    "global.weeklyLeaderboard": anyone,
    "global.recentTimelapses": anyone,
    "global.activeUsers": anyone,
    "global.stats": anyone,
    "global.maintenance": anyone,

    "hackatime.allProjects": users("timelapse:read"),
    "hackatime.linkStatus": users("timelapse:read"),
    "hackatime.myTimelapsesForProject": users("timelapse:read"),
    "hackatime.timelapsesForProject": anyone,

    "auth.authorize": anyone,
    "auth.grantConsent": website,
    "auth.session": anyone,
    "auth.token": anyone,
    "auth.signInWithPassword": anyone,
    "auth.hackatimeCallback": anyone,
    "auth.continue": anyone,

    "admin.auditLog": panel,
    "admin.stats": panel,
    "admin.list": panel,
    "admin.update": adminsOnly,
    "admin.search": panel,
    "admin.export": panel,
    "admin.recalculateDurations": panel,
    "admin.resyncHackatime": panel,
    "admin.programKey.create": rootOnly,
    "admin.programKey.list": rootOnly,
    "admin.programKey.rotate": rootOnly,
    "admin.programKey.revoke": rootOnly,
    "admin.programKey.update": rootOnly,
};

const LEVELS = { USER: 0, ADMIN: 1, ROOT: 2 };

/**
 * What should happen when `actor` calls a procedure that is for `expectation`, on something the owner owns.
 */
function expectedOutcome(expectation: Expectation, actor: ExternalActor | null, canonicalApp = false): Outcome["kind"] {
    if (expectation.for === "anyone")
        return "allowed";

    if (!actor)
        return "unauthorized";

    const scopes = "scopes" in expectation ? expectation.scopes ?? [] : [];

    if (actor.kind === "PROGRAM") {
        const held: string[] = actor.programKey.scopes;

        if (scopes.some(scope => !held.includes(scope)))
            return "forbidden";

        if (expectation.for === "users" || expectation.for === "website" || expectation.program === "never")
            return "forbidden";

        if (expectation.for === "admins")
            return held.includes(expectation.program) ? "allowed" : "forbidden";

        return held.includes(expectation.program) ? "allowed" : "refused";
    }

    const onWebsite = actor.scopes.includes("elevated");
    const level = LEVELS[actor.user.permissionLevel];

    // Being an administrator wears off an hour after signing in. Everything else about a session doesn't.
    const signedInRecently = Date.now() - actor.authenticatedAt.getTime() < 60 * 60 * 1000;

    if (expectation.for === "admins") {
        if (level < LEVELS[expectation.level])
            return "unauthorized";

        if (!onWebsite)
            return "forbidden";

        return signedInRecently ? "allowed" : "reauthenticate";
    }

    if (!onWebsite && (expectation.for === "website" || (expectation.for === "owner" && expectation.websiteOnly) || scopes.some(scope => !actor.scopes.includes(scope))))
        return "forbidden";

    if (expectation.for !== "owner" || actor.user.id === OWNER_ID)
        return "allowed";

    const asAdmin =
        expectation.admins === "ADMIN" ? level >= LEVELS.ADMIN :
        expectation.admins === "ROOT, for the canonical app" ? level >= LEVELS.ROOT && canonicalApp :
        false;

    // An administrator's powers only exist on the website: through an app they are an ordinary user.
    if (!asAdmin || !onWebsite)
        return "refused";

    return signedInRecently ? "allowed" : "reauthenticate";
}

const PROCEDURES = proceduresOf(router);

test("every procedure has a policy, and is expected to", () => {
    const names = [...PROCEDURES.keys()].toSorted();

    assert.deepEqual([...proceduresOf(compositeRouterContract).keys()].toSorted(), names);
    assert.deepEqual(Object.keys(EXPECTED).toSorted(), names, "EXPECTED must list exactly the procedures that exist");

    const policies = Object.entries(POLICIES).flatMap(([group, entries]) => Object.entries(entries).flatMap(([name, value]) =>
        "access" in value ? [`${group}.${name}`] : Object.keys(value).map(inner => `${group}.${name}.${inner}`)
    ));

    assert.deepEqual(policies.toSorted(), names, "POLICIES must list exactly the procedures that exist");
});

test("a procedure that isn't guarded by its own policy stops the server from starting", () => {
    assert.doesNotThrow(() => assertEveryProcedureIsAuthorized(router));

    const os = implement(compositeRouterContract).$context<Context>();

    const unguarded = { ...router, global: { ...router.global, stats: os.global.stats.handler(() => { throw new Error("unreachable"); }) } };
    assert.throws(() => assertEveryProcedureIsAuthorized(unguarded), /global\.stats must use authorize\("global\.stats"\)/);

    // Borrowing another procedure's policy is no better than having none.
    const borrowed = { ...router, admin: { ...router.admin, stats: router.global.stats } };
    assert.throws(() => assertEveryProcedureIsAuthorized(borrowed), /admin\.stats must use authorize\("admin\.stats"\)/);
});

for (const [who, actor] of Object.entries(CALLERS)) {
    test(`every procedure, called by ${who}`, async () => {
        for (const [name, procedure] of PROCEDURES) {
            const expected = expectedOutcome(EXPECTED[name]!, actor);
            const outcome = await request(procedure, INPUTS[name], actor);

            assert.equal(outcome.kind, expected, `${name}, called by ${who}, should be ${expected} but was ${outcome.kind}`);

            if (expected !== "allowed") {
                assert.equal(outcome.handlerRan, false, `${name} ran its handler for ${who}`);
                assert.deepEqual(outcome.database.writes, [], `${name} wrote to the database for ${who}`);
                assert.deepEqual(outcome.fetches, [], `${name} called another service for ${who}`);
            }
        }
    });
}

test("only ROOT may touch the Lapse website's own OAuth client", async () => {
    const canonical: Partial<FakeDatabaseOptions> = { rows: { serviceClient: { clientId: CANONICAL_CLIENT_ID, createdByUserId: null } } };

    for (const name of ["developer.rotateAppSecret", "developer.revokeApp", "developer.updateApp"]) {
        for (const [who, actor] of Object.entries(CALLERS)) {
            // Nobody owns the canonical client, so the owner is just another user here.
            const asOwner = actor?.kind === "USER" && actor.user.id === OWNER_ID ? userActor(OTHER_ID, actor.scopes) : actor;
            const expected = expectedOutcome(EXPECTED[name]!, asOwner, true);
            const outcome = await request(PROCEDURES.get(name)!, INPUTS[name], asOwner, { database: canonical });

            assert.equal(outcome.kind, expected, `${name} on the canonical client, called by ${who}`);
        }
    }

    // An admin gets as far as the handler of `updateApp`, which then refuses: the canonical client is only ever
    // configured from the environment.
    const outcome = await request(PROCEDURES.get("developer.updateApp")!, INPUTS["developer.updateApp"], CALLERS["ROOT, on the website"], { database: canonical });
    assert.deepEqual(outcome.database.writes, []);
    assert.match(JSON.stringify(outcome.output), /NO_PERMISSION/);
});

test("only ROOT may change the fields that decide who somebody signs in as", async () => {
    const update = PROCEDURES.get("admin.update")!;

    for (const field of ["permissionLevel", "email", "hackatimeId", "slackId"]) {
        const input = { entity: "user", id: OWNER_ID, changes: { [field]: field === "permissionLevel" ? "ROOT" : "changed" } };

        const asAdmin = await request(update, input, CALLERS["an admin, on the website"]);
        assert.match(JSON.stringify(asAdmin.output), /NO_PERMISSION/, `an admin changed ${field}`);
        assert.deepEqual(asAdmin.database.writes, []);

        const asRoot = await request(update, input, CALLERS["ROOT, on the website"]);
        assert.match(JSON.stringify(asRoot.output), /"ok":true/, `ROOT couldn't change ${field}`);
    }
});

/** Whether a response shows a timelapse the way its owner sees it. */
function showsPrivateFields(outcome: Outcome) {
    return JSON.stringify(outcome.output).includes(`"private"`);
}

test("what belongs to a user is only shown in full to them, an admin on the website, or a key with admin:read", async () => {
    // Seeing more isn't acting, so unlike everything an administrator can *do*, it doesn't take a recent sign-in.
    const mayLook = new Set<string>([
        "an admin, on the website, who signed in yesterday",
        "ROOT, on the website, who signed in yesterday",
        "the owner, on the website, who signed in yesterday",
        "the owner, on the website",
        "the owner, through an app with every scope",
        "the owner, through an app with no scopes",
        "an admin, on the website",
        "ROOT, on the website",
        "a program key with every scope, admin:read and admin:write",
        "a program key with only the admin scopes",
        "a program key with every scope there is",
    ]);

    for (const name of ["timelapse.query", "timelapse.findByUser"]) {
        for (const [who, actor] of Object.entries(CALLERS)) {
            const outcome = await request(PROCEDURES.get(name)!, INPUTS[name], actor);
            assert.equal(showsPrivateFields(outcome), mayLook.has(who), `${name}, called by ${who}`);
        }
    }

    // Unlisted timelapses of a Hackatime project take `timelapse:read` on top of that.
    const needsScope = new Set(["the owner, through an app with no scopes", "a program key with only the admin scopes"]);

    for (const [who, actor] of Object.entries(CALLERS)) {
        const outcome = await request(PROCEDURES.get("hackatime.timelapsesForProject")!, INPUTS["hackatime.timelapsesForProject"], actor);
        const query = outcome.database.calls.find(x => x.model === "timelapse" && x.method === "findMany")!;
        const visibilities = (query.args["where"] as { visibility: { in: string[] } }).visibility.in;

        assert.equal(visibilities.includes("UNLISTED"), mayLook.has(who) && !needsScope.has(who), `hackatime.timelapsesForProject, called by ${who}`);
    }

    // The feed of every timelapse, unlisted ones included, is for administrators on the website alone.
    for (const [who, actor] of Object.entries(CALLERS)) {
        const outcome = await request(PROCEDURES.get("global.recentTimelapses")!, {}, actor);
        const everything = outcome.database.calls.some(x => x.model === "timelapse" && x.method === "findMany" && Object.keys(x.args["where"] as object).length === 0);

        assert.equal(everything, /^(an admin|ROOT), on the website/.test(who), `global.recentTimelapses, called by ${who}`);
    }
});

test("a draft's Lookout token is only given to a caller that may write", async () => {
    const drafts = PROCEDURES.get("timelapse.getLookoutDrafts")!;
    const token = secretValue("draftLookoutTimelapse", "lookoutToken");

    const mayWrite = [
        CALLERS["the owner, on the website"],
        CALLERS["the owner, through an app with every scope"],
        userActor(OWNER_ID, ["timelapse:read", "timelapse:write"]),
    ];

    for (const actor of mayWrite) {
        const outcome = await request(drafts, {}, actor);
        const listed = (outcome.output as { data: { drafts: { lookoutToken: string }[] } }).data.drafts;

        assert.equal(listed.length, 1);
        assert.equal(listed[0]!.lookoutToken, token);
    }

    const readOnly = await request(drafts, {}, userActor(OWNER_ID, ["timelapse:read"]));
    const listed = (readOnly.output as { data: { drafts: { id: string; lookoutToken: string }[] } }).data.drafts;

    // Everything else about the draft is still there - only the token is withheld, and never even read.
    assert.equal(listed.length, 1);
    assert.ok(listed[0]!.id);
    assert.equal(listed[0]!.lookoutToken, "");
    assert.ok(!JSON.stringify(readOnly.output).includes(token));
    assert.ok(readOnly.database.calls.every(x => !JSON.stringify(x.args).includes("lookoutToken")), "the token was read for a caller that can't have it");
});

test("a program key's scopes are only ever the ones a program key can hold", async () => {
    const key = `pk_lapse_${"ab".repeat(32)}`;
    const database = new FakeDatabase({
        ownerId: ROOT_ID,
        omitSecrets: false,
        rows: { programKey: { keyHash: hashServiceSecret(key), keyPrefix: "abababab", scopes: ["elevated", "timelapse:read", "admin:read", "made:up"] } },
    });

    setClientsForTesting({ database: database.client, redis: {} as never });

    const actor = await getAuthenticatedUser({ headers: { authorization: `Bearer ${key}` } } as never);

    assert.equal(actor?.kind, "PROGRAM");
    assert.deepEqual(actor?.kind === "PROGRAM" && actor.programKey.scopes, ["timelapse:read", "admin:read"]);
});
