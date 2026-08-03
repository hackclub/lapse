import type { FastifyInstance } from "fastify";
import type { UserSearchMatchField, UserSearchResponse, UserSearchResult } from "@hackclub/lapse-api";
import { USER_SEARCH_DEFAULT_LIMIT, USER_SEARCH_MAX_LIMIT } from "@hackclub/lapse-api";

import { authenticatedWithAdminKey } from "@/adminKey.js";
import { database } from "@/db.js";
import { env } from "@/env.js";

const FUZZY_FALLBACK_CANDIDATES = 5_000;

const SCORE = {
    identifier: 1000,
    exactHandle: 900,
    prefixHandle: 700,
    prefixDisplayName: 600,
    substringHandle: 500,
    substringDisplayName: 400,
    substringEmail: 300,
    fuzzy: 200
} as const;

type SearchableUser = {
    id: string;
    email: string;
    handle: string;
    displayName: string;
    hackatimeId: string | null;
    slackId: string | null;
    profilePictureUrl: string;
    lastHeartbeat: Date;
    _count: { timelapses: number };
};

type UserSearchDependencies = {
    adminApiKey: string | undefined;

    findExact(query: string): Promise<SearchableUser[]>;

    findSubstring(query: string, take: number): Promise<SearchableUser[]>;
    findRecent(take: number): Promise<SearchableUser[]>;
};

type UserSearchRequest = {
    authorization: string | undefined;
    body: unknown;
};

type UserSearchReply = {
    statusCode: number;
    body: UserSearchResponse | { error: string };
};

type ParsedInput = {
    query: string;
    limit: number;
};

function parseInput(body: unknown): ParsedInput | null {
    if (!body || typeof body !== "object")
        return null;

    const { query, limit } = body as { query?: unknown; limit?: unknown };
    if (typeof query !== "string" || !query.trim())
        return null;

    if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > USER_SEARCH_MAX_LIMIT))
        return null;

    return { query: query.trim(), limit: limit ?? USER_SEARCH_DEFAULT_LIMIT };
}

function levenshteinDistance(a: string, b: string): number {
    if (a.length === 0)
        return b.length;

    if (b.length === 0)
        return a.length;

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
            current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, substitution);
        }
        previous = current;
    }

    return previous[b.length]!;
}

function fuzzyDistance(query: string, text: string): number | null {
    const distance = levenshteinDistance(query, text.toLowerCase());
    return distance <= Math.ceil(query.length / 2) ? distance : null;
}

type Ranking = {
    matchedOn: UserSearchMatchField;
    score: number;
};

function rankIdentifier(query: string, user: SearchableUser): Ranking | null {
    const candidates: Array<[UserSearchMatchField, string | null]> = [
        ["id", user.id],
        ["slackId", user.slackId],
        ["hackatimeId", user.hackatimeId]
    ];

    for (const [field, value] of candidates) {
        if (value && value.toLowerCase() === query)
            return { matchedOn: field, score: SCORE.identifier };
    }

    return null;
}

function rank(query: string, user: SearchableUser): Ranking | null {
    const identifier = rankIdentifier(query, user);
    if (identifier)
        return identifier;

    const handle = user.handle.toLowerCase();
    const displayName = user.displayName.toLowerCase();
    const email = user.email.toLowerCase();

    if (handle === query)
        return { matchedOn: "handle", score: SCORE.exactHandle };

    if (handle.startsWith(query))
        return { matchedOn: "handle", score: SCORE.prefixHandle };

    if (displayName.startsWith(query))
        return { matchedOn: "displayName", score: SCORE.prefixDisplayName };

    if (handle.includes(query))
        return { matchedOn: "handle", score: SCORE.substringHandle };

    if (displayName.includes(query))
        return { matchedOn: "displayName", score: SCORE.substringDisplayName };

    if (email.includes(query))
        return { matchedOn: "email", score: SCORE.substringEmail };

    return null;
}

function rankFuzzy(query: string, user: SearchableUser): Ranking | null {
    const handleDistance = fuzzyDistance(query, user.handle);
    const displayNameDistance = fuzzyDistance(query, user.displayName);

    if (handleDistance !== null && (displayNameDistance === null || handleDistance <= displayNameDistance))
        return { matchedOn: "handle", score: SCORE.fuzzy - handleDistance };

    if (displayNameDistance !== null)
        return { matchedOn: "displayName", score: SCORE.fuzzy - displayNameDistance };

    return null;
}

function result(user: SearchableUser, ranking: Ranking): UserSearchResult {
    return {
        lapseId: user.id,
        handle: user.handle,
        displayName: user.displayName,
        email: user.email,
        hackatimeId: user.hackatimeId,
        slackId: user.slackId,
        profilePictureUrl: user.profilePictureUrl,
        timelapseCount: user._count.timelapses,
        lastHeartbeat: user.lastHeartbeat.getTime(),
        matchedOn: ranking.matchedOn,
        score: ranking.score
    };
}

function ordered(results: UserSearchResult[], limit: number): UserSearchResult[] {
    return results
        .sort((a, b) => b.score - a.score
            || b.lastHeartbeat - a.lastHeartbeat
            || a.lapseId.localeCompare(b.lapseId))
        .slice(0, limit);
}

function ranked(
    users: SearchableUser[],
    query: string,
    ranker: (query: string, user: SearchableUser) => Ranking | null
): UserSearchResult[] {
    const results: UserSearchResult[] = [];
    for (const user of users) {
        const ranking = ranker(query, user);
        if (ranking) {
            results.push(result(user, ranking));
        }
    }
    return results;
}

export async function handleUserSearchRequest(
    request: UserSearchRequest,
    deps: UserSearchDependencies
): Promise<UserSearchReply> {
    if (!deps.adminApiKey)
        return { statusCode: 503, body: { error: "Admin user search API is not configured" } };
    if (!authenticatedWithAdminKey(request.authorization, deps.adminApiKey))
        return { statusCode: 401, body: { error: "Unauthorized" } };

    const input = parseInput(request.body);
    if (!input)
        return { statusCode: 400, body: { error: `query must be a non-empty string and limit an integer between 1 and ${USER_SEARCH_MAX_LIMIT}` } };

    const query = input.query.toLowerCase();

    const [exact, substring] = await Promise.all([
        deps.findExact(input.query),
        deps.findSubstring(input.query, input.limit * 4)
    ]);

    const deduplicated = [...new Map([...exact, ...substring].map(user => [user.id, user])).values()];
    const results = ranked(deduplicated, query, rank);
    if (results.length > 0)
        return { statusCode: 200, body: { results: ordered(results, input.limit) } };

    const candidates = await deps.findRecent(FUZZY_FALLBACK_CANDIDATES);
    return {
        statusCode: 200,
        body: { results: ordered(ranked(candidates, query, rankFuzzy), input.limit) }
    };
}

const SELECTION = {
    id: true,
    email: true,
    handle: true,
    displayName: true,
    hackatimeId: true,
    slackId: true,
    profilePictureUrl: true,
    lastHeartbeat: true,
    _count: { select: { timelapses: true } }
} as const;

const dependencies = (): UserSearchDependencies => ({
    adminApiKey: env.LAPSE_ADMIN_API_KEY,

    findExact: query => database().user.findMany({
        where: {
            OR: [
                { id: { equals: query, mode: "insensitive" } },
                { handle: { equals: query, mode: "insensitive" } },
                { slackId: { equals: query, mode: "insensitive" } },
                { hackatimeId: { equals: query, mode: "insensitive" } }
            ]
        },
        select: SELECTION
    }),

    findSubstring: (query, take) => database().user.findMany({
        where: {
            OR: [
                { handle: { contains: query, mode: "insensitive" } },
                { displayName: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } }
            ]
        },
        select: SELECTION,
        orderBy: { lastHeartbeat: "desc" },
        take
    }),

    findRecent: take => database().user.findMany({
        select: SELECTION,
        orderBy: { lastHeartbeat: "desc" },
        take
    })
});

export function registerUserSearchRoutes(server: FastifyInstance): void {
    server.post("/api/admin/users/search", async (request, reply) => {
        const result = await handleUserSearchRequest({
            authorization: request.headers.authorization,
            body: request.body
        }, dependencies());
        return reply.code(result.statusCode).send(result.body);
    });
}
