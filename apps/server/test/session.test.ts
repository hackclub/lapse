import "./support/env.js";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import jwt from "jsonwebtoken";

import { router } from "@/appRouter.js";
import { setClientsForTesting } from "@/db.js";
import { getAuthenticatedUser } from "@/oauth.js";
import { SESSION_COOKIE_NAME } from "@/session.js";

import { CANONICAL_CLIENT_ID } from "./support/env.js";
import { FakeDatabase } from "./support/fakeDatabase.js";
import { INPUTS } from "./support/inputs.js";
import { ADMIN_ID, fakeRedis, OWNER_ID, request, user } from "./support/world.js";

const WEBSITE = "https://lapse.test";
const SECRET = "test-access-token-secret";
const USERS = { [OWNER_ID]: user(OWNER_ID), [ADMIN_ID]: user(ADMIN_ID, "ADMIN") };

/** An access token like the ones `/auth/token` hands out. */
function accessToken(sub: string, options: { cid?: string; scp?: string[]; issuedSecondsAgo?: number } = {}) {
    const iat = Math.floor(Date.now() / 1000) - (options.issuedSecondsAgo ?? 0);
    return jwt.sign({ sub, cid: options.cid ?? CANONICAL_CLIENT_ID, scp: options.scp ?? ["elevated"], iat, exp: iat + 30 * 24 * 60 * 60 }, SECRET);
}

function browserRequest(headers: Record<string, string>): FastifyRequest {
    return { url: "/api/test", headers, ip: "127.0.0.1" } as FastifyRequest;
}

/** Who the server takes a request with these headers to be from. */
async function whoIs(headers: Record<string, string>, redis: Redis = fakeRedis()) {
    setClientsForTesting({ database: new FakeDatabase({ ownerId: OWNER_ID, users: USERS }).client, redis });
    return await getAuthenticatedUser(browserRequest(headers));
}

function cookie(token: string) {
    return `${SESSION_COOKIE_NAME}=${token}`;
}

/** The session cookie a response set, and the attributes it was set with. */
function sessionCookieIn(headers: Headers) {
    const header = headers.getSetCookie().find(x => x.startsWith(`${SESSION_COOKIE_NAME}=`));
    if (!header)
        return null;

    const [pair, ...attributes] = header.split(";").map(x => x.trim());
    return { value: pair!.slice(SESSION_COOKIE_NAME.length + 1), attributes: attributes.map(x => x.toLowerCase()) };
}

test("the session cookie signs in a request from the website, and nothing else", async () => {
    const session = cookie(accessToken(OWNER_ID));

    const fromWebsite = await whoIs({ origin: WEBSITE, cookie: session });
    assert.equal(fromWebsite?.kind === "USER" && fromWebsite.user.id, OWNER_ID);

    // Another site, another hackclub.com subdomain, the API's own pages, and requests that don't say where they
    // are from at all (a top-level navigation, a form posted by a page that hides its origin).
    for (const origin of ["https://evil.example", "https://attacker.hackclub.com", "https://api.lapse.test", "null", "https://lapse.test.evil.example"])
        assert.equal(await whoIs({ origin, cookie: session }), null, `a request from ${origin} was signed in by the cookie`);

    assert.equal(await whoIs({ cookie: session }), null);
    assert.equal(await whoIs({ cookie: session, "sec-fetch-site": "same-origin" }), null);
    assert.equal(await whoIs({ cookie: session, referer: `${WEBSITE}/` }), null);
});

test("the session cookie only ever holds one of the website's own tokens", async () => {
    const thirdParty = accessToken(OWNER_ID, { cid: "svc_app", scp: ["timelapse:read"] });
    assert.equal(await whoIs({ origin: WEBSITE, cookie: cookie(thirdParty) }), null);

    const forged = jwt.sign({ sub: OWNER_ID, cid: CANONICAL_CLIENT_ID, scp: ["elevated"] }, "not-the-secret", { expiresIn: "1h" });
    assert.equal(await whoIs({ origin: WEBSITE, cookie: cookie(forged) }), null);
});

test("bearer tokens work as they always have, wherever the request is from", async () => {
    const token = accessToken(OWNER_ID, { cid: "svc_app", scp: ["timelapse:read"] });

    const origins: Record<string, string>[] = [{}, { origin: "https://app.example" }, { origin: WEBSITE }];

    for (const headers of origins) {
        const actor = await whoIs({ ...headers, authorization: `Bearer ${token}` });
        assert.deepEqual(actor?.kind === "USER" && actor.scopes, ["timelapse:read"]);
    }

    // The mobile app signs in as the website does, and keeps its token.
    const mobile = await whoIs({ authorization: `Bearer ${accessToken(OWNER_ID)}` });
    assert.deepEqual(mobile?.kind === "USER" && mobile.scopes, ["elevated"]);
});

test("a tab still holding a revoked token is signed in by the cookie", async () => {
    const redis = fakeRedis();
    const old = accessToken(OWNER_ID, { issuedSecondsAgo: 60 });
    const session = accessToken(OWNER_ID);

    const signOut = router.user.signOut;
    await request(signOut, {}, null, { redis, headers: { authorization: `Bearer ${old}` } });
    assert.equal(await whoIs({ authorization: `Bearer ${old}` }, redis), null);

    const actor = await whoIs({ origin: WEBSITE, authorization: `Bearer ${old}`, cookie: cookie(session) }, redis);
    assert.equal(actor?.kind === "USER" && actor.user.id, OWNER_ID);
});

test("when somebody signed in is remembered across the move into a cookie", async () => {
    const tenDaysAgo = 10 * 24 * 60 * 60;
    const old = accessToken(ADMIN_ID, { issuedSecondsAgo: tenDaysAgo });

    const moved = await request(router.auth.session, { token: old }, null, { headers: { origin: WEBSITE } });
    const session = sessionCookieIn(moved.responseHeaders)!;
    const actor = await whoIs({ origin: WEBSITE, cookie: cookie(session.value) });

    assert.ok(actor?.kind === "USER");
    assert.ok(Math.abs(Date.now() - actor.authenticatedAt.getTime() - tenDaysAgo * 1000) < 5000, "moving a session must not count as signing in");

    // So an admin whose session was moved still has to sign in again before acting as one.
    const asAdmin = await request(router.admin.stats, {}, actor);
    assert.equal(asAdmin.kind, "reauthenticate");

    const expiry = jwt.decode(session.value) as { exp: number };
    assert.equal(expiry.exp, (jwt.decode(old) as { exp: number }).exp, "the session must not outlive the token it replaced");
});

test("the website's token moves into a cookie in two steps, and is only revoked once the cookie is in use", async () => {
    const redis = fakeRedis();
    const old = accessToken(OWNER_ID, { issuedSecondsAgo: 3600 });
    const website = { origin: WEBSITE };

    const first = await request(router.auth.session, { token: old }, null, { redis, headers: website });
    assert.deepEqual(first.output, { ok: true, data: { mode: "cookie" } });

    const session = sessionCookieIn(first.responseHeaders);
    assert.ok(session, "the first call should hand out the session cookie");
    assert.ok(session.attributes.includes("httponly"));
    assert.ok(session.attributes.includes("samesite=lax"));
    assert.ok(session.attributes.includes("path=/"));
    assert.ok(!session.attributes.some(x => x.startsWith("domain=")), "the cookie must belong to the API's host alone");
    assert.notEqual(session.value, old, "the cookie must not hold the token scripts could read");

    // Nothing is lost yet: a browser that didn't keep the cookie still has a token that works.
    assert.notEqual(await whoIs({ authorization: `Bearer ${old}` }, redis), null);

    // That browser's second call arrives without the cookie, and is told to carry on as it was.
    const withoutCookie = await request(router.auth.session, { token: old, confirm: true }, null, { redis, headers: website });
    assert.deepEqual(withoutCookie.output, { ok: true, data: { mode: "bearer" } });
    assert.notEqual(await whoIs({ authorization: `Bearer ${old}` }, redis), null);

    // A browser that did keep it sends it back, and only then does the old token stop working.
    const withCookie = { ...website, cookie: cookie(session.value) };
    const second = await request(router.auth.session, { token: old, confirm: true }, await whoIs(withCookie, redis), { redis, headers: withCookie });
    assert.deepEqual(second.output, { ok: true, data: { mode: "cookie" } });
    assert.equal(await whoIs({ authorization: `Bearer ${old}` }, redis), null, "the old token should be revoked");
    assert.notEqual(await whoIs(withCookie, redis), null, "the session should carry on");

    // Another tab that tries the same move afterwards is told the token is done with, and changes nothing.
    const again = await request(router.auth.session, { token: old }, await whoIs(withCookie, redis), { redis, headers: withCookie });
    assert.deepEqual(again.output, { ok: true, data: { mode: "cookie" } });
    assert.equal(sessionCookieIn(again.responseHeaders), null);
});

test("a token is only moved into a cookie for the website", async () => {
    const old = accessToken(OWNER_ID);

    const elsewhere: Record<string, string>[] = [{}, { origin: "https://evil.example" }, { origin: "https://attacker.hackclub.com" }];

    for (const headers of elsewhere) {
        const outcome = await request(router.auth.session, { token: old }, null, { headers });
        assert.deepEqual(outcome.output, { ok: true, data: { mode: "bearer" } });
        assert.equal(sessionCookieIn(outcome.responseHeaders), null);
    }

    // A third-party app's token is never a website session.
    const thirdParty = accessToken(OWNER_ID, { cid: "svc_app", scp: ["timelapse:read", "user:read"] });
    const outcome = await request(router.auth.session, { token: thirdParty }, null, { headers: { origin: WEBSITE } });
    assert.deepEqual(outcome.output, { ok: true, data: { mode: "bearer" } });
    assert.equal(sessionCookieIn(outcome.responseHeaders), null);
});

/** Signs in as the website's sign-in page does, up to the point of exchanging the authorization code. */
async function exchangeCode(headers: Record<string, string>, asksForCookie = true) {
    const redis = fakeRedis();
    const verifier = "a-code-verifier-that-is-long-enough-to-be-accepted-0123456789";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirectUri = `${WEBSITE}/auth`;

    await redis.set("lapse:auth:authcode:the-code", JSON.stringify({
        cid: CANONICAL_CLIENT_ID,
        sub: OWNER_ID,
        scp: ["elevated"],
        uri: redirectUri,
        ccv: challenge,
        ccm: "S256",
        exp: Date.now() + 60_000,
    }));

    const outcome = await request(router.auth.token, {
        body: {
            grant_type: "authorization_code",
            code: "the-code",
            redirect_uri: redirectUri,
            client_id: CANONICAL_CLIENT_ID,
            code_verifier: verifier,
            ...(asksForCookie ? { session: "cookie" } : {}),
        },
    }, null, {
        redis,
        headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "1", ...headers },
        database: { rows: { serviceClient: { redirectUris: [redirectUri] } } },
    });

    return { outcome, redis };
}

test("signing in on the website ends with a cookie and no token a script could read", async () => {
    const { outcome, redis } = await exchangeCode({ origin: WEBSITE });
    const response = outcome.output as { body: { access_token: string; scope: string } };

    assert.equal(response.body.access_token, "", `the website was handed a token: ${JSON.stringify(outcome.error ?? outcome.output)}`);
    assert.equal(response.body.scope, "elevated");

    const session = sessionCookieIn(outcome.responseHeaders);
    assert.ok(session?.attributes.includes("httponly"));

    const actor = await whoIs({ origin: WEBSITE, cookie: cookie(session!.value) }, redis);
    assert.deepEqual(actor?.kind === "USER" && [actor.user.id, actor.scopes], [OWNER_ID, ["elevated"]]);
});

test("signing in anywhere else still returns the token, and sets no cookie", async () => {
    const elsewhere: Record<string, string>[] = [{}, { origin: "capacitor://localhost" }, { origin: "https://preview.example" }];

    for (const headers of elsewhere) {
        const { outcome, redis } = await exchangeCode(headers);
        const response = outcome.output as { body: { access_token: string } };

        assert.ok(response?.body.access_token.length > 20, `no token for ${JSON.stringify(headers)}: ${JSON.stringify(outcome.error ?? outcome.output)}`);
        assert.equal(sessionCookieIn(outcome.responseHeaders), null);
        assert.notEqual(await whoIs({ authorization: `Bearer ${response.body.access_token}` }, redis), null);
    }
});

test("a session can't grant itself a new session", async () => {
    const actor = await whoIs({ origin: WEBSITE, cookie: cookie(accessToken(ADMIN_ID)) });

    const own = await request(router.auth.grantConsent, { clientId: CANONICAL_CLIENT_ID, state: "state", scopes: ["elevated"] }, actor, {
        database: { rows: { serviceClient: { scopes: ["elevated"] } } },
    });

    assert.equal(own.output, undefined);
    assert.match(String(own.error), /can't be granted here/);

    // Consent for somebody else's app is what this is for.
    const app = await request(router.auth.grantConsent, { clientId: "svc_app", state: "state", scopes: ["timelapse:read"] }, actor);
    assert.match(JSON.stringify(app.output), /"token"/);
});

/** Runs `body` with the `SESSION_COOKIES` switch set to `mode`. */
async function withSessionCookies(mode: "off" | "on" | "only", body: () => Promise<void>) {
    const before = process.env["SESSION_COOKIES"];
    process.env["SESSION_COOKIES"] = mode;

    try {
        await body();
    }
    finally {
        process.env["SESSION_COOKIES"] = before;
    }
}

test("a build of the website from before session cookies still gets its token, until told otherwise", async () => {
    const old = await exchangeCode({ origin: WEBSITE }, false);
    assert.ok((old.outcome.output as { body: { access_token: string } }).body.access_token.length > 20);
    assert.equal(sessionCookieIn(old.outcome.responseHeaders), null);

    await withSessionCookies("only", async () => {
        const { outcome } = await exchangeCode({ origin: WEBSITE }, false);
        assert.equal((outcome.output as { body: { access_token: string } }).body.access_token, "");
        assert.notEqual(sessionCookieIn(outcome.responseHeaders), null);

        // Still only for the website.
        const mobile = await exchangeCode({}, false);
        assert.ok((mobile.outcome.output as { body: { access_token: string } }).body.access_token.length > 20);
    });
});

test("no session cookie is handed out while they are switched off, but one already held still works", async () => {
    await withSessionCookies("off", async () => {
        const signIn = await exchangeCode({ origin: WEBSITE });
        assert.ok((signIn.outcome.output as { body: { access_token: string } }).body.access_token.length > 20);
        assert.equal(sessionCookieIn(signIn.outcome.responseHeaders), null);

        const moved = await request(router.auth.session, { token: accessToken(OWNER_ID) }, null, { headers: { origin: WEBSITE } });
        assert.deepEqual(moved.output, { ok: true, data: { mode: "bearer" } });
        assert.equal(sessionCookieIn(moved.responseHeaders), null);

        assert.notEqual(await whoIs({ origin: WEBSITE, cookie: cookie(accessToken(OWNER_ID)) }), null);
    });
});

test("signing out revokes the session and takes the cookie away", async () => {
    const redis = fakeRedis();
    const session = accessToken(OWNER_ID);
    const headers = { origin: WEBSITE, cookie: cookie(session) };

    const outcome = await request(router.user.signOut, {}, await whoIs(headers, redis), { redis, headers });
    assert.deepEqual(outcome.output, { ok: true, data: {} });
    assert.equal(sessionCookieIn(outcome.responseHeaders)?.value, "");
    assert.equal(await whoIs(headers, redis), null);

    // A page elsewhere can't sign somebody out by sending their cookie along.
    const other = accessToken(OWNER_ID, { issuedSecondsAgo: 5 });
    const crossSite = { origin: "https://attacker.hackclub.com", cookie: cookie(other) };
    await request(router.user.signOut, {}, null, { redis, headers: crossSite });
    assert.notEqual(await whoIs({ origin: WEBSITE, cookie: cookie(other) }, redis), null);
});

test("asking who is signed in keeps the cookie fresh without changing it", async () => {
    const session = accessToken(OWNER_ID, { issuedSecondsAgo: 3 * 24 * 60 * 60 });
    const headers = { origin: WEBSITE, cookie: cookie(session) };

    const outcome = await request(router.user.myself, INPUTS["user.myself"], await whoIs(headers), { headers });
    const renewed = sessionCookieIn(outcome.responseHeaders);

    assert.equal(renewed?.value, session);

    const maxAge = Number(renewed.attributes.find(x => x.startsWith("max-age="))!.slice("max-age=".length));
    const remaining = (jwt.decode(session) as { exp: number }).exp - Date.now() / 1000;
    assert.ok(Math.abs(maxAge - remaining) < 5, "the cookie must not outlive its token");

    // Bearer callers have no cookie to renew.
    const bearer = await request(router.user.myself, {}, await whoIs({ authorization: `Bearer ${session}` }), { headers: { authorization: `Bearer ${session}` } });
    assert.equal(sessionCookieIn(bearer.responseHeaders), null);
});
