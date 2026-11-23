import "./support/env.js";

import assert from "node:assert/strict";
import test from "node:test";
import type { Redis } from "ioredis";

import { setClientsForTesting } from "@/db.js";
import { hashServiceSecret, oauthModel } from "@/oauth.js";

import { FakeDatabase } from "./support/fakeDatabase.js";
import { OWNER_ID } from "./support/world.js";

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
