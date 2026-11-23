import "./support/env.js";

import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";
import { ORPCError, ValidationError } from "@orpc/server";

import { redact } from "@/logging.js";

const SECRETS = ["scs_super-secret", "the-auth-code", "the-verifier", "Basic c3ZjOnNjcw==", "__Host-lapse_session=abc"];

// A bad `/auth/token` call fails validation, and oRPC hands the raw input - body and headers - to the error it throws.
function failedTokenRequest() {
    const input = {
        body: { grant_type: "refresh_token", client_secret: SECRETS[0], code: SECRETS[1], code_verifier: SECRETS[2] },
        headers: { authorization: SECRETS[3], cookie: SECRETS[4] }
    };

    const cause = new ValidationError({ message: "Input validation failed", issues: [], data: input });
    return new ORPCError("BAD_REQUEST", { message: "Input validation failed", cause });
}

test("an error's attached request input is redacted before it's logged", () => {
    const printed = inspect(redact({ err: failedTokenRequest() }), { depth: Infinity });

    for (const secret of SECRETS)
        assert.ok(!printed.includes(secret), `logged ${secret}`);

    assert.ok(printed.includes("refresh_token"), "dropped harmless input too");
});

test("a redacted error is still the error it was", () => {
    const original = failedTokenRequest();
    const copy = redact(original);

    assert.ok(copy instanceof ORPCError);
    assert.equal(copy.message, original.message);
    assert.equal(copy.stack, original.stack);
    assert.equal(copy.code, "BAD_REQUEST");
    assert.ok(copy.cause instanceof ValidationError);
});
