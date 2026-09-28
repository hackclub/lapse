import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    allowStart,
    consentPageUrl,
    isExchangeBody,
    readPairingQuery,
    START_LIMIT_PER_MINUTE,
} from "./lookoutDesktopPolicy.ts";

const challenge = "a".repeat(43);
const state = "b".repeat(22);

describe("readPairingQuery", () => {
    it("accepts the query the desktop app sends", () => {
        expectQuery({
            challenge,
            state,
            device: "Lookout Desktop (macOS)",
        });
    });

    it("rejects a missing challenge, a short state, and a blank device", () => {
        assert.equal(readPairingQuery({ state, device: "Lookout" }), null);
        assert.equal(readPairingQuery({ challenge, state: "short", device: "Lookout" }), null);
        assert.equal(readPairingQuery({ challenge, state, device: "  " }), null);
        assert.equal(readPairingQuery({ challenge, state, device: "bad\nlabel" }), null);
    });
});

describe("consentPageUrl", () => {
    it("sends the browser to a fixed path on the website", () => {
        const url = new URL(consentPageUrl("https://lapse.hackclub.com", {
            challenge,
            state,
            device: "Lookout Desktop (macOS)",
        }));
        assert.equal(url.origin, "https://lapse.hackclub.com");
        assert.equal(url.pathname, "/lookout/pair");
        assert.equal(url.searchParams.get("device"), "Lookout Desktop (macOS)");
        assert.equal(url.searchParams.get("challenge"), challenge);
    });
});

describe("isExchangeBody", () => {
    it("requires a code and a verifier", () => {
        assert.equal(isExchangeBody({ code: "c".repeat(43), verifier: "v".repeat(43) }), true);
        assert.equal(isExchangeBody({ code: "short", verifier: "v".repeat(43) }), false);
        assert.equal(isExchangeBody(null), false);
    });
});

describe("allowStart", () => {
    it("caps a device at the per-minute budget", () => {
        const recent: number[] = [];
        for (let i = 0; i < START_LIMIT_PER_MINUTE; i++)
            assert.equal(allowStart(recent, 1_000), true);
        assert.equal(allowStart(recent, 1_000), false);
        assert.equal(allowStart(recent, 1_000 + 60_000), true);
    });
});

function expectQuery(query: { challenge: string; state: string; device: string }) {
    assert.deepEqual(readPairingQuery(query), query);
}
