import { createHash } from "node:crypto";

import type { Database } from "@/db.js";
import { SECRET_COLUMNS } from "@/secrets.js";

import { readEnums, readSchema, type SchemaField, type SchemaModel } from "./schema.js";

/**
 * An in-memory stand-in for the database, in which every table holds exactly one row and every row belongs to
 * `ownerId`. It understands just enough of a query - `where` on plain values, `select`, `include`, `omit` - to drive
 * the routers through their real code paths, and records every call so tests can tell what a request touched.
 */
export interface FakeDatabaseOptions {
    /** The user every row belongs to. */
    ownerId: string;

    /** Column values for the one row of a model, keyed by the model's client name (e.g. `timelapse`). */
    rows?: Record<string, Record<string, unknown>>;

    /** Column values for specific users, keyed by user ID. */
    users?: Record<string, Record<string, unknown>>;

    /**
     * Whether secret columns are left out of results, as the real client does. Turning this off simulates the list
     * of secret columns being forgotten, to check that nothing relies on it alone.
     */
    omitSecrets?: boolean;

    /** Returns `true` for a query that should find nothing. */
    missing?: (model: string, where: Record<string, unknown>) => boolean;
}

export interface FakeDatabaseCall {
    model: string;
    method: string;
    args: Record<string, unknown>;
}

const WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

/** Columns that say whose a row is. A `where` on one of these is a real condition; on anything else it's a lookup. */
const OWNERSHIP_COLUMNS = new Set(["ownerId", "authorId", "userId", "createdByUserId", "reviewedByUserId", "actorId"]);

const SCHEMA = readSchema();
const ENUMS = readEnums();

export function secretValue(model: string, column: string) {
    return `secret-value-of-${model}.${column}`;
}

/** Every value a secret column can take in the fake database. */
export function allSecretValues(): string[] {
    return Object.entries(SECRET_COLUMNS).flatMap(([model, columns]) => Object.keys(columns).map(column => secretValue(model, column)));
}

function stableUuid(seed: string) {
    const hex = createHash("sha256").update(seed).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function rowId(modelKey: string) {
    return stableUuid(modelKey);
}

const ENUM_DEFAULTS: Record<string, string> = {
    PermissionLevel: "USER",
    TimelapseVisibility: "PUBLIC",
    RecordingClient: "BROWSER",
    ServiceClientTrustLevel: "UNTRUSTED",
};

const KEPT_OPTIONAL: Record<string, unknown> = {
    hackatimeId: "4242",
    slackId: "U0TEST",
    hackatimeProject: "lapse",
    lookoutSessionId: stableUuid("lookout-session"),
    lookoutVideoUrl: "https://lookout.test/video.mp4",
    lookoutThumbnailUrl: "https://lookout.test/thumbnail.jpg",
    recordedWith: "BROWSER",
};

/** Optional links to another row that are set anyway - most are `null`, like a draft that isn't being published. */
const KEPT_REFERENCES = new Set(["createdByUserId", "actorId"]);

function defaultValue(model: SchemaModel, field: SchemaField, ownerId: string): unknown {
    const secrets: Record<string, Record<string, boolean>> = SECRET_COLUMNS;
    if (secrets[model.key]?.[field.name])
        return secretValue(model.key, field.name);

    if (field.references) {
        if (field.isOptional && !KEPT_REFERENCES.has(field.name))
            return null;

        return field.references === "User" ? ownerId : rowId(SCHEMA.get(field.references)!.key);
    }

    if (field.name in KEPT_OPTIONAL)
        return KEPT_OPTIONAL[field.name];

    if (field.isOptional)
        return null;

    if (field.type.startsWith("enum:")) {
        const name = field.type.slice("enum:".length);
        const value = ENUM_DEFAULTS[name] ?? ENUMS.get(name)![0]!;
        return field.isList ? [value] : value;
    }

    if (field.name === "id" || field.name === "code" || field.name === "jti")
        return model.name === "User" ? ownerId : rowId(model.key);

    switch (field.type) {
        case "DateTime": {
            // Old enough to pass for a recording made with the legacy recorder, and after the owner signed up.
            const date = model.name === "User" && field.name === "createdAt" ? new Date("2024-01-01T00:00:00Z") : new Date("2025-01-01T00:00:00Z");
            if (field.name === "expiresAt" || field.name === "endsAt")
                return new Date(Date.now() + 24 * 60 * 60 * 1000);

            return field.isList ? [date, new Date(date.getTime() + 60_000)] : date;
        }

        case "Int": return 1;
        case "Float": return 120;
        case "Boolean": return false;
        case "Json": return field.isList ? [] : {};
    }

    if (field.name === "scopes")
        return ["timelapse:read"];

    if (field.name === "redirectUris")
        return ["https://app.test/callback"];

    if (field.name === "sessions")
        return ["timelapses/session0.webm"];

    if (field.isList)
        return [];

    if (/url$/i.test(field.name))
        return `https://lapse.test/${field.name}`;

    if (field.name === "handle")
        return "somebody";

    if (field.name === "email")
        return "somebody@lapse.test";

    if (field.name === "iv")
        return "00".repeat(16);

    return `${field.name} text`;
}

type Args = Record<string, unknown>;

function isPlain(value: unknown): value is string | number | boolean | null {
    return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

export class FakeDatabase {
    readonly calls: FakeDatabaseCall[] = [];

    constructor(readonly options: FakeDatabaseOptions) {}

    get writes() {
        return this.calls.filter(x => WRITES.has(x.method));
    }

    /** The client the server uses, backed by this fake. */
    get client(): Database {
        const models = new Map([...SCHEMA.values()].map(model => [model.key, model]));

        const client: Record<string, unknown> = {
            $transaction: async (work: unknown) => {
                if (typeof work === "function")
                    return await (work as (tx: unknown) => Promise<unknown>)(proxy);

                return await Promise.all(work as Promise<unknown>[]);
            },
            $queryRaw: async () => [],
        };

        const proxy: unknown = new Proxy(client, {
            get: (target, property) => {
                if (typeof property !== "string" || property in target)
                    return target[property as string];

                const model = models.get(property);
                if (!model)
                    return undefined;

                return new Proxy({}, {
                    get: (_, method) => (args: Args = {}) => this.run(model, String(method), args),
                });
            },
        });

        return proxy as Database;
    }

    private async run(model: SchemaModel, method: string, args: Args): Promise<unknown> {
        this.calls.push({ model: model.key, method, args });

        const where = isRecord(args["where"]) ? args["where"] : {};

        switch (method) {
            case "count":
                return this.find(model, where) ? 1 : 0;

            case "aggregate":
                return { _sum: { duration: 120 }, _avg: { duration: 120 }, _max: { duration: 120 }, _count: 1 };

            case "groupBy":
                return [{ ownerId: this.options.ownerId, hackatimeProject: "lapse", _sum: { duration: 120 } }];

            case "createMany":
                return { count: 1 };

            case "updateMany":
            case "deleteMany":
                return { count: this.find(model, where) ? 1 : 0 };

            case "findMany": {
                const row = this.find(model, where);
                return row ? [this.shape(model, row, args)] : [];
            }

            case "create":
                return this.shape(model, { ...this.row(model, {}), ...plainValues(args["data"]) }, args);

            case "upsert": {
                const row = this.find(model, where) ?? this.row(model, {});
                return this.shape(model, { ...row, ...plainValues(args["create"]) }, args);
            }

            case "update": {
                const row = this.find(model, where);
                if (!row)
                    throw new Error(`No ${model.name} to update.`);

                return this.shape(model, { ...row, ...plainValues(args["data"]) }, args);
            }

            default: {
                const row = this.find(model, where);
                if (!row && method.endsWith("OrThrow"))
                    throw new Error(`No ${model.name} found.`);

                return row ? this.shape(model, row, args) : null;
            }
        }
    }

    /** The model's one row, taking on whatever `where` looks it up by - unless `where` asks for a different owner. */
    private find(model: SchemaModel, where: Record<string, unknown>): Record<string, unknown> | null {
        if (this.options.missing?.(model.key, where))
            return null;

        const row = this.row(model, where);

        for (const [column, expected] of Object.entries(flattenWhere(where))) {
            if (OWNERSHIP_COLUMNS.has(column) && isPlain(expected) && row[column] !== expected)
                return null;
        }

        return row;
    }

    private row(model: SchemaModel, where: Record<string, unknown>): Record<string, unknown> {
        const row: Record<string, unknown> = {};
        for (const field of model.scalars)
            row[field.name] = defaultValue(model, field, this.options.ownerId);

        Object.assign(row, this.options.rows?.[model.key]);

        for (const [column, value] of Object.entries(flattenWhere(where))) {
            if (isPlain(value) && value !== null && !OWNERSHIP_COLUMNS.has(column) && model.scalars.some(x => x.name === column && !x.isList))
                row[column] = value;
        }

        if (model.name === "User")
            Object.assign(row, this.options.users?.[String(row["id"])]);

        return row;
    }

    private shape(model: SchemaModel, row: Record<string, unknown>, args: Args): Record<string, unknown> {
        const select = isRecord(args["select"]) ? args["select"] : null;
        const include = isRecord(args["include"]) ? args["include"] : {};
        const omit = isRecord(args["omit"]) ? args["omit"] : {};
        const secrets: Record<string, Record<string, boolean>> = SECRET_COLUMNS;
        const result: Record<string, unknown> = {};

        for (const field of model.scalars) {
            const omitted = omit[field.name] ?? (this.options.omitSecrets !== false && Boolean(secrets[model.key]?.[field.name]));
            if (select ? select[field.name] === true : !omitted)
                result[field.name] = row[field.name];
        }

        for (const relation of model.relations) {
            const wanted = select ? select[relation.name] : include[relation.name];
            if (!wanted)
                continue;

            const target = SCHEMA.get(relation.type)!;
            const foreignKey = model.scalars.find(x => x.references === relation.type);
            const related = this.row(target, !relation.isList && foreignKey && target.scalars.some(x => x.name === "id") ? { id: row[foreignKey.name] } : {});
            const shaped = this.shape(target, related, isRecord(wanted) ? wanted : {});

            result[relation.name] = relation.isList ? [shaped] : shaped;
        }

        return result;
    }
}

function plainValues(data: unknown): Record<string, unknown> {
    if (!isRecord(data))
        return {};

    return Object.fromEntries(Object.entries(data).filter(([, value]) => isPlain(value) || value instanceof Date || Array.isArray(value)));
}

/** The plain `column: value` conditions of a `where`, including those of a compound unique key. */
function flattenWhere(where: Record<string, unknown>): Record<string, unknown> {
    const flat: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(where)) {
        if (isPlain(value))
            flat[key] = value;
        else if (isRecord(value) && key.includes("_"))
            Object.assign(flat, flattenWhere(value));
    }

    return flat;
}
