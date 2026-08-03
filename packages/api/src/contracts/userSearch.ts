import { z } from "zod";

export const USER_SEARCH_DEFAULT_LIMIT = 25;
export const USER_SEARCH_MAX_LIMIT = 50;

export const UserSearchMatchFieldSchema = z.enum([
    "id",
    "handle",
    "displayName",
    "email",
    "slackId",
    "hackatimeId"
]);

export const UserSearchResultSchema = z.object({
    lapseId: z.string(),
    handle: z.string(),
    displayName: z.string(),
    email: z.string(),
    hackatimeId: z.string().nullable(),
    slackId: z.string().nullable(),
    profilePictureUrl: z.string(),
    timelapseCount: z.number().int().min(0),
    lastHeartbeat: z.number(),
    matchedOn: UserSearchMatchFieldSchema,
    score: z.number()
});

export const UserSearchResponseSchema = z.object({
    results: z.array(UserSearchResultSchema)
});

export type UserSearchMatchField = z.infer<typeof UserSearchMatchFieldSchema>;
export type UserSearchResult = z.infer<typeof UserSearchResultSchema>;
export type UserSearchResponse = z.infer<typeof UserSearchResponseSchema>;
