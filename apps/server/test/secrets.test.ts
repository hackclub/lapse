import "./support/env.js";

import assert from "node:assert/strict";
import test from "node:test";
import { compositeRouterContract } from "@hackclub/lapse-api";
import z from "zod";

import { router } from "@/appRouter.js";
import { createDatabaseClient } from "@/db.js";
import { SECRET_COLUMNS } from "@/secrets.js";

import { allSecretValues, type FakeDatabaseOptions } from "./support/fakeDatabase.js";
import { INPUTS } from "./support/inputs.js";
import { readSchema } from "./support/schema.js";
import { OWNER_ID, proceduresOf, request, ROOT_ID, userActor } from "./support/world.js";

const SECRETS: Record<string, Record<string, boolean>> = SECRET_COLUMNS;
const SECRET_COLUMN_NAMES = new Set(Object.values(SECRETS).flatMap(columns => Object.keys(columns)));

/**
 * Columns that are named like a secret, but have been looked at and aren't one.
 */
const NOT_SECRET: Record<string, string> = {
    "ProgramKey.keyPrefix": "the public half of a program key, shown in the admin panel to tell keys apart",
    "DraftTimelapse.thumbnailKey": "an S3 object key, not a credential",
    "Timelapse.s3Key": "an S3 object key, not a credential",
    "Timelapse.thumbnailS3Key": "an S3 object key, not a credential",
    "LegacyUnpublishedTimelapse.thumbnailS3Key": "an S3 object key, not a credential",
    "LookoutPairingCode.code": "the row's primary key; single-use, gone five minutes after it was made, and useless without the PKCE verifier",
    "LookoutPairingCode.challenge": "a PKCE challenge, which is public by design",
};

/**
 * The only places a secret column may leave the server, and why.
 */
const INTENTIONAL_OUTPUTS: Record<string, string[]> = {
    // The browser recorder uploads to Lookout with the session's token, and resumes a draft with the same one.
    "timelapse.createRecordingSession": ["lookoutToken"],
    "timelapse.getLookoutDrafts": ["lookoutToken"],
};

test("every column that looks like a secret is classified", () => {
    const unclassified: string[] = [];

    for (const model of readSchema().values()) {
        for (const field of model.scalars) {
            const looksSecret = /token|secret|password|hash|key$|^code$|challenge|verifier/i.test(field.name);
            const isSecret = Boolean(SECRETS[model.key]?.[field.name]);

            if (looksSecret && !isSecret && !(`${model.name}.${field.name}` in NOT_SECRET))
                unclassified.push(`${model.name}.${field.name}`);
        }
    }

    assert.deepEqual(unclassified, [], "add these to SECRET_COLUMNS in secrets.ts, or to NOT_SECRET here with a reason");
});

test("every secret column exists in the schema", () => {
    const schema = new Map([...readSchema().values()].map(model => [model.key, model]));

    for (const [model, columns] of Object.entries(SECRETS)) {
        for (const column of Object.keys(columns))
            assert.ok(schema.get(model)?.scalars.some(x => x.name === column), `${model}.${column} is not a column`);
    }
});

test("the database client never selects a secret column unless asked to", async () => {
    const statements: string[] = [];
    const queryable = {
        provider: "postgres" as const,
        adapterName: "recording",
        queryRaw: async (query: { sql: string }) => {
            statements.push(query.sql);
            return { columnTypes: [], columnNames: [], rows: [] };
        },
        executeRaw: async (query: { sql: string }) => {
            statements.push(query.sql);
            return 0;
        },
    };

    const client = createDatabaseClient({
        provider: "postgres",
        adapterName: "recording",
        connect: async () => ({
            ...queryable,
            executeScript: async () => {},
            dispose: async () => {},
            startTransaction: async () => ({ ...queryable, options: { usePhantomQuery: false }, commit: async () => {}, rollback: async () => {} }),
        }),
    });

    await client.user.findFirst();
    await client.user.findMany({ include: { timelapses: true, lookoutDrafts: true, lookoutDevices: true, serviceClients: true, programKeysCreated: true } });
    await client.timelapse.findMany({ include: { owner: true, comments: { include: { author: true } } } });
    await client.draftLookoutTimelapse.findMany({ include: { owner: true } });
    await client.lookoutDevice.findFirst({ include: { owner: true } });
    await client.serviceClient.findMany({ include: { createdByUser: true } });
    await client.programKey.findMany({ include: { createdByUser: true } });

    assert.ok(statements.length >= 7);

    for (const statement of statements) {
        for (const column of SECRET_COLUMN_NAMES)
            assert.ok(!statement.includes(`"${column}"`), `${column} was selected by: ${statement}`);
    }

    statements.length = 0;
    await client.user.findFirst({ omit: { hackatimeAccessToken: false } });
    assert.ok(statements[0]!.includes(`"hackatimeAccessToken"`), "a query that asks for a secret by name should get it");
    assert.ok(!statements[0]!.includes(`"hackatimeRefreshToken"`));
});

/** Every property name an output schema can produce, and whether part of it accepts arbitrary keys. */
function describeOutput(schema: z.core.JSONSchema.BaseSchema, keys = new Set<string>()): { keys: Set<string>; open: boolean } {
    let open = false;

    const visit = (node: unknown) => {
        if (Array.isArray(node))
            return node.forEach(visit);

        if (typeof node !== "object" || node === null)
            return;

        const object = node as Record<string, unknown>;
        if (typeof object["properties"] === "object" && object["properties"] !== null) {
            for (const key of Object.keys(object["properties"]))
                keys.add(key);
        }

        // `{}` is JSON Schema for "anything", which is what `z.unknown()` and an open record come out as.
        if (object["additionalProperties"] !== undefined && object["additionalProperties"] !== false)
            open = true;

        Object.values(object).forEach(visit);
    };

    visit(schema);
    return { keys, open };
}

/**
 * Procedures whose output schema accepts arbitrary keys, so the schema can't vouch for what comes back. Each is
 * checked by actually calling it below.
 */
const OPEN_OUTPUTS = new Set(["admin.export", "admin.list", "admin.update", "admin.auditLog", "auth.continue", "auth.token", "auth.authorize", "auth.hackatimeCallback"]);

test("no output schema names a secret column", () => {
    const open: string[] = [];

    for (const [name, procedure] of proceduresOf(router)) {
        const schema = procedure["~orpc"].outputSchema as z.ZodType | undefined;
        assert.ok(schema, `${name} has no output schema, so anything could be returned from it`);

        const output = describeOutput(z.toJSONSchema(schema, { unrepresentable: "any", io: "output" }));
        const leaked = [...output.keys].filter(key => SECRET_COLUMN_NAMES.has(key) && !INTENTIONAL_OUTPUTS[name]?.includes(key));

        assert.deepEqual(leaked, [], `${name} returns a secret column`);

        if (output.open)
            open.push(name);
    }

    assert.deepEqual(open.filter(name => !OPEN_OUTPUTS.has(name)), [], "these outputs accept arbitrary keys - check them and add them to OPEN_OUTPUTS");
});

test("every procedure has a test input", () => {
    const names = [...proceduresOf(router).keys()];

    assert.deepEqual(names.filter(name => !(name in INPUTS)), [], "add an input for these to test/support/inputs.ts");
    assert.deepEqual(Object.keys(INPUTS).filter(name => !names.includes(name)), [], "these inputs are for procedures that no longer exist");
    assert.deepEqual(names.toSorted(), [...proceduresOf(compositeRouterContract).keys()].toSorted());
});

const ADMIN_ENTITIES = ["user", "timelapse", "comment", "draftTimelapse", "lookoutDraft", "legacyTimelapse"];

/** The inputs to try for a procedure: its usual one, or one per entity for the admin procedures that take any. */
function inputsFor(name: string): unknown[] {
    const input = INPUTS[name];

    if (name === "admin.export" || name === "admin.list")
        return ADMIN_ENTITIES.map(entity => ({ ...input as object, entity }));

    return [input];
}

/**
 * Requests that take the less-travelled paths through the code that handles secrets: a recording that publishes
 * as a side effect of being looked at, and one that's published outright.
 */
const DEEPER: { name: string; database: Partial<FakeDatabaseOptions> }[] = [
    { name: "timelapse.publishFromLookout", database: { missing: (model, where) => model === "timelapse" && "lookoutSessionId" in where } },
    ...["timelapse.pollLookoutStatus", "timelapse.getLookoutDrafts"].map(name => ({
        name,
        database: {
            rows: { draftLookoutTimelapse: { pendingAt: new Date(), pendingName: "A timelapse", pendingVisibility: "PUBLIC", pendingHackatimeProject: "lapse" } },
            missing: (model: string, where: Record<string, unknown>) => model === "timelapse" && "lookoutSessionId" in where,
        },
    })),
    { name: "timelapse.syncWithHackatime", database: { rows: { timelapse: { hackatimeProject: null } } } },
];

for (const omitSecrets of [true, false]) {
    test(`no procedure returns the value of a secret column (secret columns ${omitSecrets ? "omitted" : "not omitted"})`, async () => {
        const secrets = allSecretValues();
        let completed = 0;

        for (const [name, procedure] of proceduresOf(router)) {
            for (const input of inputsFor(name)) {
                // As the row's owner and as ROOT, the two callers who are shown the most.
                for (const actor of [userActor(OWNER_ID, ["elevated"]), userActor(ROOT_ID, ["elevated"])]) {
                    const outcome = await request(procedure, input, actor, { database: { omitSecrets } });
                    if (outcome.output === undefined)
                        continue;

                    completed++;
                    const body = JSON.stringify(outcome.output);

                    for (const secret of secrets) {
                        const column = secret.split(".")[1]!;
                        if (INTENTIONAL_OUTPUTS[name]?.includes(column))
                            continue;

                        assert.ok(!body.includes(secret), `${name} returned ${secret}`);
                    }
                }
            }
        }

        const procedures = proceduresOf(router);

        for (const { name, database } of DEEPER) {
            const outcome = await request(procedures.get(name)!, INPUTS[name], userActor(OWNER_ID, ["elevated"]), { database: { omitSecrets, ...database } });
            const body = JSON.stringify(outcome.output);

            assert.ok(body.includes(`"ok":true`), `${name} didn't succeed: ${body ?? outcome.error}`);

            for (const secret of secrets) {
                if (!INTENTIONAL_OUTPUTS[name]?.includes(secret.split(".")[1]!))
                    assert.ok(!body.includes(secret), `${name} returned ${secret}`);
            }
        }

        // If the fake world stopped answering, this test would pass by looking at nothing.
        assert.ok(completed >= 150, `only ${completed} calls produced an output`);
    });
}
