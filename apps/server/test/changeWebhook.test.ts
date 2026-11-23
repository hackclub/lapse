import "./support/env.js";

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { changeWebhookSignature, deliverTimelapseChange, notifyTimelapseChanged } from "@/changeWebhook.js";
import { setClientsForTesting } from "@/db.js";

import { FakeDatabase } from "./support/fakeDatabase.js";
import { fakeRedis, OWNER_ID, user } from "./support/world.js";

const URL = "https://subscriber.test/hooks/lapse";
const SECRET = "webhook-test-secret";

interface Sent {
    url: string;
    headers: Headers;
    body: string;
    redirect: RequestInit["redirect"];
}

/**
 * Checks a request's `x-lapse-signature` the way a subscriber would: recompute `v1` from the stated time and the
 * body, and require that time to be now.
 */
function assertSignedNow(sent: Sent) {
    const header = sent.headers.get("x-lapse-signature")!;
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
    assert.ok(match, `unexpected signature header ${header}`);
    const t = Number(match[1]);
    assert.ok(Math.abs(Date.now() / 1000 - t) < 5, "signed with the time it was sent");
    assert.equal(header, changeWebhookSignature(sent.body, SECRET, t));
}

/**
 * Points the webhook at a fake subscriber that answers each request with the next of `statuses` (200 once they run out),
 * and returns what it was sent.
 */
function fakeSubscriber(statuses: number[] = []): Sent[] {
    process.env["TIMELAPSE_WEBHOOK_URL"] = URL;
    process.env["TIMELAPSE_WEBHOOK_SECRET"] = SECRET;
    setClientsForTesting({ database: new FakeDatabase({ ownerId: OWNER_ID, users: { [OWNER_ID]: { ...user(OWNER_ID) } } }).client, redis: fakeRedis() });

    const sent: Sent[] = [];
    globalThis.fetch = async (input, init) => {
        sent.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body), redirect: init?.redirect });
        return new Response("{}", { status: statuses.shift() ?? 200 });
    };

    return sent;
}

const realFetch = globalThis.fetch;

test.afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env["TIMELAPSE_WEBHOOK_URL"];
    delete process.env["TIMELAPSE_WEBHOOK_SECRET"];
});

test("the signature is t=<time>,v1=<lowercase hex HMAC-SHA256 of '<time>.<body>'>", () => {
    // Worked out with `printf '%s' '1700000000.<body>' | openssl dgst -sha256 -hmac webhook-test-secret`.
    assert.equal(
        changeWebhookSignature(`{"event":"timelapse.deleted","id":"abcdefghijkl"}`, SECRET, 1700000000),
        "t=1700000000,v1=cc329916005daf493bd45f88f116d73cc5680b2a9a21291e7a86aaf906e46432"
    );

    // Over the UTF-8 bytes, which is what the subscriber receives.
    const body = JSON.stringify({ event: "timelapse.updated", id: "x", timelapse: { name: "Café ☕" } });
    assert.equal(changeWebhookSignature(body, SECRET, 42), `t=42,v1=${createHmac("sha256", SECRET).update(Buffer.from(`42.${body}`, "utf8")).digest("hex")}`);

    // The time is part of what's signed: the same body at another time has another signature.
    assert.notEqual(changeWebhookSignature(body, SECRET, 42), changeWebhookSignature(body, SECRET, 43).replace("t=43", "t=42"));
});

test("a deletion is sent as just its ID, signed over the exact body sent", async () => {
    const sent = fakeSubscriber();
    await deliverTimelapseChange("timelapse.deleted", "abcdefghijkl", 0);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.url, URL);
    assert.equal(sent[0]!.headers.get("content-type"), "application/json");
    assert.equal(sent[0]!.body, `{"event":"timelapse.deleted","id":"abcdefghijkl"}`);
    assertSignedNow(sent[0]!);
    // Never re-sent somewhere else by a redirect.
    assert.equal(sent[0]!.redirect, "error");
});

test("a published or updated timelapse is sent in full, owner and private fields included", async () => {
    for (const event of ["timelapse.published", "timelapse.updated"] as const) {
        const sent = fakeSubscriber();
        await deliverTimelapseChange(event, "entity000001", 0);

        assert.equal(sent.length, 1);
        const body = JSON.parse(sent[0]!.body) as { event: string; id: string; timelapse: { id: string; owner: { slackId: string }; private: unknown } };

        assert.equal(body.event, event);
        assert.equal(body.id, "entity000001");
        assert.equal(body.timelapse.id, "entity000001");
        assert.equal(body.timelapse.owner.slackId, "U0TEST");
        assert.ok(body.timelapse.private);
        assertSignedNow(sent[0]!);
    }
});

test("a failed delivery is retried once, and then given up on without throwing", async () => {
    const recovered = fakeSubscriber([503]);
    await deliverTimelapseChange("timelapse.deleted", "abcdefghijkl", 0);
    assert.equal(recovered.length, 2);
    assert.equal(recovered[1]!.body, recovered[0]!.body);

    const down = fakeSubscriber([500, 502, 500]);
    await deliverTimelapseChange("timelapse.deleted", "abcdefghijkl", 0);
    assert.equal(down.length, 2);

    fakeSubscriber();
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    await deliverTimelapseChange("timelapse.deleted", "abcdefghijkl", 0);
});

test("nothing is sent unless both the URL and the secret are set", async () => {
    const sent = fakeSubscriber();
    delete process.env["TIMELAPSE_WEBHOOK_SECRET"];

    notifyTimelapseChanged("timelapse.deleted", "abcdefghijkl");
    await deliverTimelapseChange("timelapse.deleted", "abcdefghijkl", 0);
    assert.deepEqual(sent, []);
});
