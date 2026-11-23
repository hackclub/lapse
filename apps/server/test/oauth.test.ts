import "./support/env.js";

import assert from "node:assert/strict";
import test from "node:test";
import type { Redis } from "ioredis";
import jwt from "jsonwebtoken";
import { ORPCError } from "@orpc/server";

import { router } from "@/appRouter.js";
import { setClientsForTesting } from "@/db.js";
import { checkAccessToken, hashServiceSecret, oauthModel, revokeGrantTokens } from "@/oauth.js";

import { CANONICAL_CLIENT_ID } from "./support/env.js";
import { FakeDatabase } from "./support/fakeDatabase.js";
import { fakeRedis, OWNER_ID, request, user } from "./support/world.js";

const CLIENT_ID = "svc_thirdparty";
const SECRET = "scs_correct-horse-battery-staple";

function withClient(secretHash: string) {
    const database = new FakeDatabase({
        ownerId: OWNER_ID,
        rows: { serviceClient: { clientId: CLIENT_ID, clientSecretHash: secretHash, scopes: ["timelapse:read"], redirectUris: ["https://example.com/callback"] } }
    });

    setClientsForTesting({ database: database.client, redis: {} as Redis });
}

// Secrets are hashed with a fresh salt each time, so checking one means hashing it again with the stored salt - not
// comparing against a new hash, which never matches and turned away every third-party app's token exchange.
test("a third-party app is let in with its own client secret", async () => {
    withClient(hashServiceSecret(SECRET));

    const client = await oauthModel.getClient(CLIENT_ID, SECRET);
    assert.ok(client);
    assert.equal(client.id, CLIENT_ID);
});

test("a third-party app is turned away with the wrong client secret", async () => {
    withClient(hashServiceSecret(SECRET));

    assert.equal(await oauthModel.getClient(CLIENT_ID, "scs_wrong"), null);
});

test("a revoked third-party app is turned away even with its client secret", async () => {
    const database = new FakeDatabase({
        ownerId: OWNER_ID,
        rows: { serviceClient: { clientId: CLIENT_ID, clientSecretHash: hashServiceSecret(SECRET), revokedAt: new Date() } }
    });
    setClientsForTesting({ database: database.client, redis: {} as Redis });

    assert.equal(await oauthModel.getClient(CLIENT_ID, SECRET), null);
});

/** An access token like the ones `/auth/token` hands out. */
function accessToken(cid: string, issuedSecondsAgo = 0) {
    const iat = Math.floor(Date.now() / 1000) - issuedSecondsAgo;
    return jwt.sign({ sub: OWNER_ID, cid, scp: ["timelapse:read"], iat, exp: iat + 30 * 24 * 60 * 60 }, "test-access-token-secret");
}

function world(options: { clientRevoked?: boolean } = {}) {
    const redis = fakeRedis();
    const database = new FakeDatabase({
        ownerId: OWNER_ID,
        users: { [OWNER_ID]: user(OWNER_ID) },
        rows: { serviceClient: { revokedAt: options.clientRevoked ? new Date() : null } }
    });

    setClientsForTesting({ database: database.client, redis });
    return redis;
}

test("a third-party app's token works while the app does", async () => {
    world();
    assert.equal((await checkAccessToken(accessToken(CLIENT_ID))).status, "valid");
});

test("revoking an app cuts off the tokens it already holds", async () => {
    world({ clientRevoked: true });
    assert.equal((await checkAccessToken(accessToken(CLIENT_ID))).status, "invalid");
});

test("disconnecting an app cuts off its earlier tokens, but not ones from connecting it again", async () => {
    world();
    const before = accessToken(CLIENT_ID, 60);

    await revokeGrantTokens(CLIENT_ID, OWNER_ID);
    assert.equal((await checkAccessToken(before)).status, "invalid");

    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal((await checkAccessToken(accessToken(CLIENT_ID))).status, "valid");
});

test("disconnecting a third-party app leaves the website signed in", async () => {
    world();
    await revokeGrantTokens(CLIENT_ID, OWNER_ID);
    assert.equal((await checkAccessToken(accessToken(CANONICAL_CLIENT_ID, 60))).status, "valid");
});

function startOAuth(redirectUri: string) {
    return request(
        router.auth.authorize,
        {
            query: {
                response_type: "code",
                client_id: CANONICAL_CLIENT_ID,
                redirect_uri: redirectUri,
                scope: "elevated",
                state: "state",
                code_challenge: "challenge",
                code_challenge_method: "S256"
            }
        },
        null,
        { database: { rows: { serviceClient: { redirectUris: ["https://lapse.test/auth"] } } } }
    );
}

test("signing in to an app with one of its own redirect URIs goes on to Hackatime", async () => {
    const outcome = await startOAuth("https://lapse.test/auth");

    assert.equal(outcome.error, undefined);
    assert.ok(outcome.responseHeaders.getSetCookie().length > 0);
});

test("signing in with a redirect URI the app never registered goes nowhere", async () => {
    const outcome = await startOAuth("https://evil.example/steal");

    assert.ok(outcome.error instanceof ORPCError);
    assert.equal(outcome.error.code, "BAD_REQUEST");
    assert.equal(outcome.responseHeaders.getSetCookie().length, 0);
});
