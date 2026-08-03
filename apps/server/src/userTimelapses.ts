import type { FastifyInstance } from "fastify";
import type { UserTimelapseSummary, UserTimelapsesResponse } from "@hackclub/lapse-api";
import { USER_TIMELAPSES_DEFAULT_LIMIT, USER_TIMELAPSES_MAX_LIMIT } from "@hackclub/lapse-api";

import { ADMIN_ROUTES, registerAdminRoute, type AdminReply } from "@/adminKey.js";
import { database } from "@/db.js";
import { env } from "@/env.js";

type Owner = UserTimelapsesResponse["owner"];

type Row = {
    id: string;
    name: string;
    createdAt: Date;
    visibility: UserTimelapseSummary["visibility"];
    duration: number;
    thumbnailS3Key: string | null;
    lookoutThumbnailUrl: string | null;
    lookoutSessionId: string | null;
    hackatimeProject: string | null;
    associatedJobId: string | null;
    snapshots: Date[];
};

type Dependencies = {
    findOwner(where: OwnerQuery): Promise<Owner | null>;
    findTimelapses(ownerId: string, take: number, cursor: string | null): Promise<Row[]>;
    countTimelapses(ownerId: string): Promise<number>;
    publicStorageUrl: string;
};

export type OwnerQuery = { lapseId: string } | { hackatimeId: string } | { handle: string };

type Input = { where: OwnerQuery; limit: number; cursor: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function parseInput(body: unknown): Input | null {
    if (!body || typeof body !== "object")
        return null;

    const { lapseId, hackatimeId, handle, limit, cursor } = body as Record<string, unknown>;
    const ids = [str(lapseId), str(hackatimeId), str(handle)];
    if (ids.filter(Boolean).length !== 1)
        return null;

    if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > USER_TIMELAPSES_MAX_LIMIT))
        return null;

    if (cursor !== undefined && cursor !== null && !str(cursor))
        return null;

    const [id, hackatime, h] = ids;
    const where: OwnerQuery = id ? { lapseId: id } : hackatime ? { hackatimeId: hackatime } : { handle: h! };
    return { where, limit: limit ?? USER_TIMELAPSES_DEFAULT_LIMIT, cursor: str(cursor) };
}

const dto = (row: Row, publicStorageUrl: string): UserTimelapseSummary => ({
    id: row.id,
    title: row.name,
    createdAt: row.createdAt.getTime(),
    visibility: row.visibility,
    duration: row.duration,
    thumbnailUrl: row.lookoutThumbnailUrl
        ?? (row.thumbnailS3Key ? `${publicStorageUrl}/${row.thumbnailS3Key}` : null),
    hackatimeProject: row.hackatimeProject,
    snapshotCount: row.snapshots.length,
    provenance: row.lookoutSessionId ? "lookout" : "legacy",
    processing: row.associatedJobId !== null
});

export async function handleUserTimelapsesRequest(
    body: unknown,
    deps: Dependencies
): Promise<AdminReply<UserTimelapsesResponse>> {
    const input = parseInput(body);
    if (!input)
        return {
            statusCode: 400,
            body: { error: `provide exactly one of lapseId, hackatimeId or handle, an optional integer limit between 1 and ${USER_TIMELAPSES_MAX_LIMIT}, and an optional string cursor` }
        };

    const owner = await deps.findOwner(input.where);
    if (!owner)
        return { statusCode: 404, body: { error: "No such Lapse user" } };

    const [rows, total] = await Promise.all([
        deps.findTimelapses(owner.lapseId, input.limit + 1, input.cursor),
        deps.countTimelapses(owner.lapseId)
    ]);

    const page = rows.slice(0, input.limit);
    return {
        statusCode: 200,
        body: {
            owner,
            timelapses: page.map(r => dto(r, deps.publicStorageUrl)),
            total,
            nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null
        }
    };
}

const OWNER_SELECTION = {
    id: true,
    handle: true,
    displayName: true,
    hackatimeId: true,
    slackId: true
} as const;

const ROW_SELECTION = {
    id: true,
    name: true,
    createdAt: true,
    visibility: true,
    duration: true,
    thumbnailS3Key: true,
    lookoutThumbnailUrl: true,
    lookoutSessionId: true,
    hackatimeProject: true,
    associatedJobId: true,
    snapshots: true
} as const;

const ownerWhere = (q: OwnerQuery) =>
    "lapseId" in q
        ? { id: q.lapseId }
        : "hackatimeId" in q
            ? { hackatimeId: q.hackatimeId }
            : { handle: { equals: q.handle, mode: "insensitive" as const } };

const dependencies = (): Dependencies => ({
    findOwner: async q => {
        const u = await database().user.findFirst({ where: ownerWhere(q), select: OWNER_SELECTION });
        return u && { lapseId: u.id, handle: u.handle, displayName: u.displayName, hackatimeId: u.hackatimeId, slackId: u.slackId };
    },

    findTimelapses: (ownerId, take, cursor) => database().timelapse.findMany({
        where: { ownerId },
        select: ROW_SELECTION,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    }),

    countTimelapses: ownerId => database().timelapse.count({ where: { ownerId } }),
    publicStorageUrl: env.S3_PUBLIC_URL_PUBLIC
});

export function registerUserTimelapseRoutes(server: FastifyInstance): void {
    registerAdminRoute(server, ADMIN_ROUTES.userTimelapses, body =>
        handleUserTimelapsesRequest(body, dependencies()));
}
