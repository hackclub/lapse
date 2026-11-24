import "./support/env.js";

import assert from "node:assert/strict";
import test from "node:test";

import { router } from "@/appRouter.js";
import { setClientsForTesting, type Database } from "@/db.js";
import { decodeChangeCursor, encodeChangeCursor, listTimelapseChanges, SETTLE_MS, type TimelapseChange } from "@/timelapseChanges.js";

import { fakeRedis, OWNER_ID, programActor, proceduresOf, request, THIRD_PARTY_SCOPES, user, userActor } from "./support/world.js";

type Row = Record<string, unknown>;

/**
 * Just enough of Prisma's `findMany` over two in-memory tables to run the change feed's real queries: `where` with
 * `gt`/`gte`/`lt`/`lte`/`in` and `OR`, `orderBy`, `take`, and `select`. IDs are compared as JavaScript compares them,
 * standing in for whatever collation Postgres uses - the feed never compares IDs itself.
 */
class Tables {
    readonly timelapses: Row[] = [];
    readonly deletions: Row[] = [];

    upsert(id: string, updatedAt: number) {
        this.timelapses.push({
            id,
            updatedAt: new Date(updatedAt),
            createdAt: new Date(updatedAt),
            name: `Timelapse ${id}`,
            description: "",
            visibility: "UNLISTED",
            blocker: null,
            s3Key: null,
            thumbnailS3Key: null,
            lookoutVideoUrl: null,
            lookoutThumbnailUrl: null,
            associatedJobId: "job-1",
            duration: 60,
            hackatimeProject: "lapse",
            sourceDraftId: null,
            lookoutSessionId: null,
            ownerId: OWNER_ID,
            owner: user(OWNER_ID),
            comments: [],
        });
    }

    delete(id: string, deletedAt: number) {
        this.deletions.push({ timelapseId: id, ownerId: OWNER_ID, deletedAt: new Date(deletedAt) });
    }

    get client(): Database {
        return {
            timelapse: { findMany: async (args: Row) => findMany(this.timelapses, args) },
            timelapseDeletion: { findMany: async (args: Row) => findMany(this.deletions, args) },
        } as unknown as Database;
    }
}

function comparable(value: unknown): number | string {
    return value instanceof Date ? value.getTime() : value as number | string;
}

function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (key === "OR")
            return (condition as Row[]).some(x => matches(row, x));

        const value = comparable(row[key]);
        if (typeof condition !== "object" || condition === null || condition instanceof Date)
            return value === comparable(condition);

        return Object.entries(condition as Row).every(([op, operand]) => {
            if (op === "in")
                return (operand as unknown[]).includes(value);

            const other = comparable(operand);
            return op === "gt" ? value > other : op === "gte" ? value >= other : op === "lt" ? value < other : op === "lte" ? value <= other : false;
        });
    });
}

function findMany(rows: Row[], args: Row): Row[] {
    let found = rows.filter(row => matches(row, (args["where"] as Row | undefined) ?? {}));

    const orderBy = (args["orderBy"] as Record<string, "asc" | "desc">[] | undefined) ?? [];
    found = found.toSorted((a, b) => {
        for (const order of orderBy) {
            const [[column, direction]] = Object.entries(order) as [[string, "asc" | "desc"]];
            const x = comparable(a[column]);
            const y = comparable(b[column]);
            if (x !== y)
                return (x < y ? -1 : 1) * (direction === "asc" ? 1 : -1);
        }

        return 0;
    });

    if (typeof args["take"] === "number")
        found = found.slice(0, args["take"]);

    const select = args["select"] as Record<string, boolean> | undefined;
    return select ? found.map(row => Object.fromEntries(Object.keys(select).map(key => [key, row[key]]))) : found;
}

function use(tables: Tables) {
    setClientsForTesting({ database: tables.client, redis: fakeRedis() });
}

/** How a change reads in an assertion, e.g. `1000 delete z`. */
function describe(change: TimelapseChange) {
    return `${change.changedAt} ${change.kind} ${change.kind === "delete" ? change.id : change.timelapse.id}`;
}

const LATER = 1_000_000;

test("upserts and deletions come as one stream, by time, then deletions first, then ID", async () => {
    const tables = new Tables();
    tables.upsert("b", 1000);
    tables.upsert("a", 1000);
    tables.delete("z", 1000);
    tables.delete("y", 500);
    tables.upsert("c", 2000);
    use(tables);

    const page = await listTimelapseChanges(undefined, 200, LATER);

    assert.deepEqual(page.changes.map(describe), ["500 delete y", "1000 delete z", "1000 upsert a", "1000 upsert b", "2000 upsert c"]);
    assert.equal(page.hasMore, false);
    assert.deepEqual(decodeChangeCursor(page.nextCursor), { changedAt: 2000, kind: "upsert", id: "c" });
});

test("paging lists every change exactly once, across upserts and deletions sharing a millisecond", async () => {
    const tables = new Tables();
    const expected: string[] = [];

    // Eleven changes per millisecond, so that pages of every size split a millisecond somewhere - including between
    // the deletions and the upserts.
    for (const at of [1000, 1001, 1002, 1500]) {
        for (const id of ["d1", "d2", "d3", "d4"].map(x => `${x}-${at}`)) {
            tables.delete(id, at);
            expected.push(`${at} delete ${id}`);
        }

        for (const id of ["u1", "u2", "u3", "u4", "u5", "u6", "u7"].map(x => `${x}-${at}`)) {
            tables.upsert(id, at);
            expected.push(`${at} upsert ${id}`);
        }
    }

    use(tables);

    for (const limit of [1, 2, 3, 4, 5, 7, 11, 13, 44, 45, 200]) {
        const seen: string[] = [];
        let cursor: string | undefined;

        while (true) {
            const page = await listTimelapseChanges(cursor, limit, LATER);
            assert.ok(page.changes.length <= limit);
            seen.push(...page.changes.map(describe));

            if (!page.hasMore) {
                cursor = page.nextCursor;
                break;
            }

            assert.equal(page.changes.length, limit, `a page that isn't the last should be full (limit ${limit})`);
            cursor = page.nextCursor;
        }

        assert.deepEqual(seen, expected, `with pages of ${limit}`);

        // Caught up: asking again lists nothing and hands the same cursor back.
        const after = await listTimelapseChanges(cursor, limit, LATER);
        assert.deepEqual(after.changes, []);
        assert.equal(after.hasMore, false);
        assert.equal(after.nextCursor, cursor);
    }
});

test("a change made after the caller caught up comes in the next page, wherever it sorts in its millisecond", async () => {
    const tables = new Tables();
    tables.upsert("m", 1000);
    use(tables);

    const first = await listTimelapseChanges(undefined, 200, LATER);
    assert.deepEqual(first.changes.map(describe), ["1000 upsert m"]);

    // The timelapse is edited, another is deleted, and a third is published - one of them in the same millisecond
    // and after the cursor by kind, one after it by ID.
    tables.timelapses.find(x => x["id"] === "m")!["updatedAt"] = new Date(3000);
    tables.delete("gone", 3000);
    tables.upsert("n", 1000);

    const second = await listTimelapseChanges(first.nextCursor, 200, LATER);
    assert.deepEqual(second.changes.map(describe), ["1000 upsert n", "3000 delete gone", "3000 upsert m"]);
});

test("with nothing to list, the cursor comes back as it was, or as the beginning", async () => {
    use(new Tables());

    const fromStart = await listTimelapseChanges(undefined, 200, LATER);
    assert.deepEqual(fromStart, { changes: [], nextCursor: encodeChangeCursor(null), hasMore: false });
    assert.equal(decodeChangeCursor(fromStart.nextCursor), null);

    const cursor = encodeChangeCursor({ changedAt: 1234, kind: "delete", id: "x" });
    assert.deepEqual(await listTimelapseChanges(cursor, 200, LATER), { changes: [], nextCursor: cursor, hasMore: false });
});

test("changes younger than the settle window wait, so one committed late with an earlier time isn't skipped", async () => {
    // Times relative to the window, so this holds whatever SETTLE_MS is.
    const now = 1_000_000;
    const cutoff = now - SETTLE_MS;
    const tables = new Tables();
    tables.upsert("old", cutoff - 6000);
    tables.upsert("settled", cutoff);
    tables.upsert("fresh", cutoff + 3000);
    use(tables);

    const first = await listTimelapseChanges(undefined, 200, now);
    assert.deepEqual(first.changes.map(describe), [`${cutoff - 6000} upsert old`, `${cutoff} upsert settled`]);
    assert.equal(first.hasMore, false);

    // Writes stamped before "fresh" that were still in flight during the first listing. Had "fresh" been listed then,
    // the caller's cursor would be past them for good.
    tables.upsert("late", cutoff + 1000);
    tables.delete("late-deletion", cutoff + 1000);

    const second = await listTimelapseChanges(first.nextCursor, 200, now + SETTLE_MS + 10_000);
    assert.deepEqual(second.changes.map(describe), [`${cutoff + 1000} delete late-deletion`, `${cutoff + 1000} upsert late`, `${cutoff + 3000} upsert fresh`]);
});

test("an upsert is the full timelapse, owner and private fields included, whatever its visibility or state", async () => {
    const tables = new Tables();
    tables.upsert("processing", 1000);
    tables.timelapses[0]!["visibility"] = "FAILED_PROCESSING";
    use(tables);

    const [change] = (await listTimelapseChanges(undefined, 200, LATER)).changes;
    assert.equal(change?.kind, "upsert");
    assert.ok(change.kind === "upsert");
    assert.equal(change.timelapse.visibility, "FAILED_PROCESSING");
    assert.equal(change.timelapse.playbackUrl, null);
    assert.equal(change.timelapse.owner.slackId, "U0TEST");
    assert.deepEqual(change.timelapse.private, { hackatimeProject: "lapse", sourceDraftId: null, lookoutSessionId: null });
});

test("a cursor is opaque but checked", () => {
    for (const position of [null, { changedAt: 0, kind: "upsert" as const, id: "abc" }, { changedAt: 1_700_000_000_123, kind: "delete" as const, id: "x_y-Z" }])
        assert.deepEqual(decodeChangeCursor(encodeChangeCursor(position)), position);

    for (const garbage of ["", "nope", Buffer.from("[2]").toString("base64url"), Buffer.from("[1,-5,\"upsert\",\"a\"]").toString("base64url"), Buffer.from("[1,5,\"other\",\"a\"]").toString("base64url")])
        assert.equal(decodeChangeCursor(garbage), undefined, garbage);
});

const listChanged = proceduresOf(router).get("timelapse.listChanged")!;

test("timelapse.listChanged is only for administrators on the website and program keys with admin:read", async () => {
    const outcomes = {
        nobody: await request(listChanged, {}, null),
        owner: await request(listChanged, {}, userActor(OWNER_ID, ["elevated"])),
        "an admin through an app": await request(listChanged, {}, userActor("admin0000003", THIRD_PARTY_SCOPES)),
        "a key with timelapse:read alone": await request(listChanged, {}, programActor(["timelapse:read"])),
        "a key with admin:read alone": await request(listChanged, {}, programActor(["admin:read"])),
        "a key with admin:write": await request(listChanged, {}, programActor(["timelapse:read", "admin:write", "admin:panel"])),
        "a key with timelapse:read and admin:read": await request(listChanged, {}, programActor(["timelapse:read", "admin:read"])),
        "an admin on the website": await request(listChanged, {}, userActor("admin0000003", ["elevated"])),
    };

    assert.deepEqual(Object.fromEntries(Object.entries(outcomes).map(([who, outcome]) => [who, outcome.kind])), {
        nobody: "unauthorized",
        owner: "unauthorized",
        "an admin through an app": "forbidden",
        "a key with timelapse:read alone": "forbidden",
        "a key with admin:read alone": "forbidden",
        "a key with admin:write": "forbidden",
        "a key with timelapse:read and admin:read": "allowed",
        "an admin on the website": "allowed",
    });

    for (const outcome of Object.values(outcomes).filter(x => x.kind !== "allowed"))
        assert.deepEqual(outcome.database.calls, []);
});

test("timelapse.listChanged turns away a cursor it didn't make", async () => {
    const outcome = await request(listChanged, { cursor: "not-a-cursor" }, programActor(["timelapse:read", "admin:read"]));

    assert.match(JSON.stringify(outcome.output), /"ok":false/);
    assert.deepEqual(outcome.database.calls, []);
});
