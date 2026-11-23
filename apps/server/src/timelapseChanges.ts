import { z } from "zod";
import type { OwnedTimelapse } from "@hackclub/lapse-api";

import type * as db from "@/generated/prisma/client.js";
import { database } from "@/db.js";
import { dtoOwnedTimelapse, TIMELAPSE_INCLUDES, TIMELAPSE_OMIT } from "@/routers/timelapse.js";

/**
 * The change feed behind `timelapse.listChanged`: every timelapse that was created or changed (by `updatedAt`) and
 * every one that was deleted (by `TimelapseDeletion.deletedAt`), as one stream in ascending order of
 * `(changedAt, kind, id)`, deletions sorting before upserts at the same millisecond. A cursor is the position of the
 * last change a caller has seen; the next page starts strictly after it.
 *
 * Ties are broken by kind before ID so that the two tables' IDs never have to be compared with each other: Postgres
 * orders IDs by the column's collation, which JavaScript can't reproduce, so each table's IDs are only ever compared
 * by Postgres, within that table, the same way it sorted them.
 */
export type TimelapseChange =
    | { kind: "upsert"; changedAt: number; timelapse: OwnedTimelapse }
    | { kind: "delete"; changedAt: number; id: string; ownerId: string };

export type ChangeKind = TimelapseChange["kind"];

export interface ChangePosition {
    changedAt: number;
    kind: ChangeKind;
    id: string;
}

export interface ChangePage {
    changes: TimelapseChange[];
    nextCursor: string;
    hasMore: boolean;
}

/**
 * Changes younger than this aren't listed yet. `updatedAt` is stamped by the app server when a write is sent, not by
 * Postgres when it commits, so a change can become visible after a later one already has - and a caller whose cursor
 * had moved past it would never see it. Waiting this long lets slow commits land and absorbs clock drift between
 * server instances. It only delays the feed: the change webhook already reports each change as it happens.
 */
export const SETTLE_MS = 30_000;

const KIND_ORDER: Record<ChangeKind, number> = { delete: 0, upsert: 1 };

const CursorSchema = z.union([
    z.tuple([z.literal(1)]),
    z.tuple([z.literal(1), z.number().int().nonnegative(), z.enum(["delete", "upsert"]), z.string().min(1)])
]);

/**
 * Encodes a position in the feed as an opaque cursor. `null` is the very beginning.
 */
export function encodeChangeCursor(position: ChangePosition | null): string {
    const value = position ? [1, position.changedAt, position.kind, position.id] : [1];
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Reads a cursor made by `encodeChangeCursor`. `null` is the very beginning; `undefined` means it isn't a cursor.
 */
export function decodeChangeCursor(cursor: string): ChangePosition | null | undefined {
    let value: unknown;
    try {
        value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    }
    catch {
        return undefined;
    }

    const parsed = CursorSchema.safeParse(value);
    if (!parsed.success)
        return undefined;

    if (parsed.data.length === 1)
        return null;

    const [, changedAt, kind, id] = parsed.data;
    return { changedAt, kind, id };
}

function upsertsAfter(position: ChangePosition | null, until: Date): db.Prisma.TimelapseWhereInput {
    if (!position)
        return { updatedAt: { lte: until } };

    const at = new Date(position.changedAt);

    // Upserts sort after deletions at the same millisecond, so after a deletion every upsert of that millisecond is new.
    if (position.kind === "delete")
        return { updatedAt: { gte: at, lte: until } };

    // `gte` as well as the `OR` so that Postgres can start its index scan at `at` instead of filtering from the start.
    return { updatedAt: { gte: at, lte: until }, OR: [{ updatedAt: { gt: at } }, { id: { gt: position.id } }] };
}

function deletionsAfter(position: ChangePosition | null, until: Date): db.Prisma.TimelapseDeletionWhereInput {
    if (!position)
        return { deletedAt: { lte: until } };

    const at = new Date(position.changedAt);

    if (position.kind === "upsert")
        return { deletedAt: { gt: at, lte: until } };

    return { deletedAt: { gte: at, lte: until }, OR: [{ deletedAt: { gt: at } }, { timelapseId: { gt: position.id } }] };
}

/**
 * Lists up to `limit` changes after `cursor` (from the beginning without one), among those at least `SETTLE_MS` old
 * as of `now`. `cursor` must already be known to be valid - see `decodeChangeCursor`.
 */
export async function listTimelapseChanges(cursor: string | undefined, limit: number, now = Date.now()): Promise<ChangePage> {
    const position = cursor === undefined ? null : decodeChangeCursor(cursor);
    if (position === undefined)
        throw new Error("listTimelapseChanges was given a cursor that isn't one.");

    const until = new Date(now - SETTLE_MS);

    // One more than a page from each table is enough to fill the page and know whether there is another.
    const [upserts, deletions] = await Promise.all([
        database().timelapse.findMany({
            where: upsertsAfter(position, until),
            select: { id: true, updatedAt: true },
            orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
            take: limit + 1
        }),
        database().timelapseDeletion.findMany({
            where: deletionsAfter(position, until),
            orderBy: [{ deletedAt: "asc" }, { timelapseId: "asc" }],
            take: limit + 1
        })
    ]);

    // A stable sort, so each table's rows keep the order Postgres gave them within a millisecond.
    const merged = [
        ...deletions.map(x => ({ changedAt: x.deletedAt.getTime(), kind: "delete" as const, id: x.timelapseId, ownerId: x.ownerId })),
        ...upserts.map(x => ({ changedAt: x.updatedAt.getTime(), kind: "upsert" as const, id: x.id, ownerId: null }))
    ].sort((a, b) => a.changedAt - b.changedAt || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

    const page = merged.slice(0, limit);
    const hasMore = merged.length > limit;

    const upsertIds = page.filter(x => x.kind === "upsert").map(x => x.id);
    const timelapses = upsertIds.length === 0 ? [] : await database().timelapse.findMany({
        where: { id: { in: upsertIds } },
        include: TIMELAPSE_INCLUDES,
        omit: TIMELAPSE_OMIT
    });

    const byId = new Map(timelapses.map(x => [x.id, x]));
    const changes: TimelapseChange[] = [];

    for (const entry of page) {
        if (entry.kind === "delete") {
            changes.push({ kind: "delete", changedAt: entry.changedAt, id: entry.id, ownerId: entry.ownerId });
            continue;
        }

        // Deleted since it was listed. Its deletion is newer than this change, so it comes up later in the feed.
        const timelapse = byId.get(entry.id);
        if (timelapse)
            changes.push({ kind: "upsert", changedAt: entry.changedAt, timelapse: dtoOwnedTimelapse(timelapse) });
    }

    const last = page.at(-1);

    return {
        changes,
        nextCursor: last ? encodeChangeCursor({ changedAt: last.changedAt, kind: last.kind, id: last.id }) : cursor ?? encodeChangeCursor(null),
        hasMore
    };
}
