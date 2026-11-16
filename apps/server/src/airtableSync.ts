import { randomBytes } from "node:crypto";

import { database, redis } from "@/db.js";
import { env } from "@/env.js";
import { logError, logInfo } from "@/logging.js";

/**
 * Mirrors per-user stats into an Airtable table that Loops reads from, the way Hackatime used to
 * (`UpdateAirtableUserDataJob`). One row per email, upserted on `Email`, so Loops sees one contact
 * even when several Lapse accounts share an address.
 *
 * Airtable's native Sync API would be simpler, but an integrated sync source caps out at 10,000
 * rows and Lapse is already close to that, so this goes through the regular records API.
 */

const FIELDS = {
    email: "Email",
    userIds: "Lapse User ID",
    handle: "Handle",
    displayName: "Display Name",
    slackId: "Slack ID",
    signedUpAt: "Signed Up At",
    lastActiveAt: "Last Active At",
    firstTimelapseAt: "First Timelapse At",
    lastTimelapseAt: "Last Timelapse At",
    timelapseCount: "Timelapse Count",
    totalMinutesRecorded: "Total Minutes Recorded",
    hackatimeConnected: "Hackatime Connected",
} as const;

type FieldValue = string | number | boolean | null;
type Row = Record<(typeof FIELDS)[keyof typeof FIELDS], FieldValue>;
type AirtableRecord = { id: string; fields: Record<string, unknown> };

const DATE_FIELDS = new Set<string>([FIELDS.signedUpAt, FIELDS.lastActiveAt, FIELDS.firstTimelapseAt, FIELDS.lastTimelapseAt]);

/** Airtable takes at most 10 records per write. */
const WRITE_BATCH = 10;
/** Airtable allows 5 requests per second per base; stay under it. */
const REQUEST_SPACING_MS = 250;
/** Airtable blocks a base for 30 seconds after a 429. */
const RATE_LIMIT_BACKOFF_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

type AirtableConfig = { token: string; baseId: string; tableId: string };

function config(): AirtableConfig | null {
    const token = env.AIRTABLE_SYNC_TOKEN;
    const baseId = env.AIRTABLE_SYNC_BASE_ID;
    const tableId = env.AIRTABLE_SYNC_TABLE_ID;
    if (!token || !baseId || !tableId)
        return null;

    return { token, baseId, tableId };
}

export function isAirtableSyncEnabled(): boolean {
    return config() !== null;
}

async function airtable<T>(cfg: AirtableConfig, method: string, query: URLSearchParams | null, body?: unknown): Promise<T> {
    const url = `https://api.airtable.com/v0/${cfg.baseId}/${cfg.tableId}${query ? `?${query}` : ""}`;

    for (let attempt = 0; ; attempt++) {
        await sleep(REQUEST_SPACING_MS);

        const res = await fetch(url, {
            method,
            headers: {
                "Authorization": `Bearer ${cfg.token}`,
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (res.status === 429 && attempt < 3) {
            await sleep(RATE_LIMIT_BACKOFF_MS);
            continue;
        }

        if (!res.ok)
            throw new Error(`Airtable ${method} failed with ${res.status}: ${(await res.text()).slice(0, 500)}`);

        return await res.json() as T;
    }
}

async function listRecords(cfg: AirtableConfig, filterByFormula?: string): Promise<AirtableRecord[]> {
    const records: AirtableRecord[] = [];
    let offset: string | undefined;

    do {
        const query = new URLSearchParams({ pageSize: "100" });
        if (filterByFormula)
            query.set("filterByFormula", filterByFormula);

        if (offset)
            query.set("offset", offset);

        const page = await airtable<{ records: AirtableRecord[]; offset?: string }>(cfg, "GET", query);
        records.push(...page.records);
        offset = page.offset;
    } while (offset);

    return records;
}

async function upsertRows(cfg: AirtableConfig, rows: Row[]): Promise<void> {
    for (const batch of chunks(rows, WRITE_BATCH)) {
        await airtable(cfg, "PATCH", null, {
            performUpsert: { fieldsToMergeOn: [FIELDS.email] },
            records: batch.map(fields => ({ fields })),
        });
    }
}

async function deleteRecords(cfg: AirtableConfig, ids: string[]): Promise<void> {
    for (const batch of chunks(ids, WRITE_BATCH)) {
        const query = new URLSearchParams();
        for (const id of batch)
            query.append("records[]", id);

        await airtable(cfg, "DELETE", query);
    }
}

/**
 * Builds one row per (lowercased) email. Accounts sharing an address are merged: stats are summed,
 * and the profile fields come from the most recently active account.
 */
async function buildRows(): Promise<Map<string, Row>> {
    const [users, stats] = await Promise.all([
        database().user.findMany({
            select: {
                id: true,
                email: true,
                handle: true,
                displayName: true,
                slackId: true,
                createdAt: true,
                lastHeartbeat: true,
                hackatimeId: true,
            },
            orderBy: { lastHeartbeat: "desc" },
        }),
        database().timelapse.groupBy({
            by: ["ownerId"],
            _count: { _all: true },
            _min: { createdAt: true },
            _max: { createdAt: true },
            _sum: { duration: true },
        }),
    ]);

    const statsByUser = new Map(stats.map(stat => [stat.ownerId, stat]));
    const rows = new Map<string, Row>();

    for (const user of users) {
        const email = user.email.trim().toLowerCase();
        if (!email)
            continue;

        const stat = statsByUser.get(user.id);
        const count = stat?._count._all ?? 0;
        const seconds = stat?._sum.duration ?? 0;
        const first = stat?._min.createdAt ?? null;
        const last = stat?._max.createdAt ?? null;

        const existing = rows.get(email);
        if (!existing) {
            rows.set(email, {
                [FIELDS.email]: email,
                [FIELDS.userIds]: user.id,
                [FIELDS.handle]: user.handle,
                [FIELDS.displayName]: user.displayName,
                [FIELDS.slackId]: user.slackId,
                [FIELDS.signedUpAt]: user.createdAt.toISOString(),
                [FIELDS.lastActiveAt]: user.lastHeartbeat.toISOString(),
                [FIELDS.firstTimelapseAt]: first?.toISOString() ?? null,
                [FIELDS.lastTimelapseAt]: last?.toISOString() ?? null,
                [FIELDS.timelapseCount]: count,
                [FIELDS.totalMinutesRecorded]: Math.floor(seconds / 60),
                [FIELDS.hackatimeConnected]: user.hackatimeId !== null,
            });
            continue;
        }

        // `users` is sorted by activity, so the first account seen keeps the profile fields.
        const totalSeconds = Number(existing[FIELDS.totalMinutesRecorded]) * 60 + seconds;
        existing[FIELDS.userIds] = `${existing[FIELDS.userIds]}, ${user.id}`;
        existing[FIELDS.slackId] ??= user.slackId;
        existing[FIELDS.signedUpAt] = minIso(existing[FIELDS.signedUpAt], user.createdAt.toISOString());
        existing[FIELDS.firstTimelapseAt] = minIso(existing[FIELDS.firstTimelapseAt], first?.toISOString() ?? null);
        existing[FIELDS.lastTimelapseAt] = maxIso(existing[FIELDS.lastTimelapseAt], last?.toISOString() ?? null);
        existing[FIELDS.timelapseCount] = Number(existing[FIELDS.timelapseCount]) + count;
        existing[FIELDS.totalMinutesRecorded] = Math.floor(totalSeconds / 60);
        existing[FIELDS.hackatimeConnected] = existing[FIELDS.hackatimeConnected] === true || user.hackatimeId !== null;
    }

    return rows;
}

/**
 * Airtable omits empty fields and false checkboxes, and returns dates with milliseconds, so compare
 * on normalized values rather than raw JSON.
 */
function sameRow(row: Row, record: AirtableRecord): boolean {
    return Object.entries(row).every(([field, value]) => sameValue(field, value, record.fields[field]));
}

function sameValue(field: string, value: FieldValue, remote: unknown): boolean {
    if (DATE_FIELDS.has(field))
        return (value === null ? null : Date.parse(String(value))) === (typeof remote === "string" ? Date.parse(remote) : null);

    if (typeof value === "boolean")
        return value === (remote === true);

    return (value ?? "") === (remote ?? "");
}

/**
 * Brings the table in line with the database: upserts rows that changed and deletes rows whose
 * email no longer belongs to any account (erased users, changed addresses).
 */
export async function syncUsersToAirtable(): Promise<void> {
    const cfg = config();
    if (!cfg)
        return;

    const startedAt = Date.now();
    const [rows, records] = await Promise.all([buildRows(), listRecords(cfg)]);

    const remoteByEmail = new Map<string, AirtableRecord>();
    const stale: string[] = [];

    for (const record of records) {
        const value = record.fields[FIELDS.email];
        const email = typeof value === "string" ? value.trim().toLowerCase() : "";

        // Duplicates make the upsert ambiguous ("multiple records match"), so keep only the first.
        if (!email || !rows.has(email) || remoteByEmail.has(email))
            stale.push(record.id);
        else
            remoteByEmail.set(email, record);
    }

    const changed = [...rows.entries()]
        .filter(([email, row]) => {
            const remote = remoteByEmail.get(email);
            return !remote || !sameRow(row, remote);
        })
        .map(([, row]) => row);

    await deleteRecords(cfg, stale);
    await upsertRows(cfg, changed);

    logInfo(`Synced users to Airtable: ${changed.length} upserted, ${stale.length} deleted, ${rows.size} total, in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
}

/**
 * Removes the rows for the given emails straight away, for privacy erasures. The daily sync would
 * get there too, but not within the time the privacy hub expects. Returns how many rows matched.
 */
export async function deleteAirtableRowsForEmails(emails: string[], dryRun: boolean): Promise<number> {
    const cfg = config();
    const normalized = [...new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))];
    if (!cfg || normalized.length === 0)
        return 0;

    const formula = `OR(${normalized.map(email => `LOWER({${FIELDS.email}})=${JSON.stringify(email)}`).join(",")})`;
    const records = await listRecords(cfg, formula);

    if (!dryRun)
        await deleteRecords(cfg, records.map(record => record.id));

    return records.length;
}

const SYNC_KEY = "lapse:airtable_user_sync";
const SYNC_CHECK_INTERVAL_MS = 10 * 60_000;
const SYNC_INTERVAL_MS = 24 * 60 * 60_000;
const SYNC_RETRY_MS = 60 * 60_000;

/**
 * Runs the sync at most once a day across all replicas. The Redis key is both the lock and the
 * schedule: whoever sets it runs the sync, and nobody else does until it expires.
 */
async function syncIfDue(): Promise<void> {
    const token = randomBytes(16).toString("hex");
    const held = await redis().set(SYNC_KEY, token, "PX", SYNC_INTERVAL_MS, "NX");
    if (held !== "OK")
        return;

    try {
        await syncUsersToAirtable();
    }
    catch (err) {
        // Try again in an hour rather than tomorrow, without letting every replica pile on at once.
        await redis().pexpire(SYNC_KEY, SYNC_RETRY_MS).catch(() => undefined);
        throw err;
    }
}

export function startAirtableUserSync(): NodeJS.Timeout | null {
    if (!isAirtableSyncEnabled())
        return null;

    const timer = setInterval(() => {
        void syncIfDue().catch(err => logError("Airtable user sync failed.", { err }));
    }, SYNC_CHECK_INTERVAL_MS);

    timer.unref();
    return timer;
}

function chunks<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size)
        result.push(items.slice(i, i + size));

    return result;
}

function minIso(a: FieldValue, b: string | null): string | null {
    if (typeof a !== "string")
        return b;

    if (b === null)
        return a;

    return Date.parse(b) < Date.parse(a) ? b : a;
}

function maxIso(a: FieldValue, b: string | null): string | null {
    if (typeof a !== "string")
        return b;

    if (b === null)
        return a;

    return Date.parse(b) > Date.parse(a) ? b : a;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
