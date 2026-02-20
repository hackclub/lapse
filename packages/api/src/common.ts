import z from "zod";

/**
 * A 12-character Nano ID, used to represent all public entities.
 */
export const LapseId = z.string();

/**
 * Represents a timestamp, measured in milliseconds, since the UNIX epoch. This represents all
 * dates for the API.
 */
export const LapseDate = z.number().nonnegative();

/**
 * Represents errors that are shared between both the client and the server. These identifiers specify the exact
 * class of error that an `ApiResult<T>` *or* `Result<T>` describe.
 */
export type LapseError = z.infer<typeof LapseErrorSchema>;
export const LapseErrorSchema = z.enum([
    "ERROR",
    "NOT_FOUND",
    "DEVICE_NOT_FOUND",
    "NOT_MUTABLE",
    "MISSING_PARAMS",
    "SIZE_LIMIT",
    "NO_PERMISSION",
    "HACKATIME_ERROR",
    "ALREADY_PUBLISHED",
    "NO_FILE",
    "EXPIRED"
]);

/**
 * Represents the structure of a JSON API response.
 */
export type LapseResult<T> =
    { ok: true, data: T } |
    { ok: false, error: LapseError, message: string };

/**
 * Creates the schema of an API response result, with `dataSchema` being the schema of the
 * returned data.
 */
export function createResultSchema<T extends z.ZodType>(dataSchema: T) {
    return z.discriminatedUnion("ok", [
        z.object({
            ok: z.literal(true),
            data: dataSchema
        }),

        z.object({
            ok: z.literal(false),
            error: LapseErrorSchema,
            message: z.string()
        })
    ]);
}

/**
 * Encapsulates a Zod shape (similar to what would be present in `z.object(...)`) in a `LapseResult<T>`-like schema.
 */
export function apiResult<T extends z.core.$ZodLooseShape>(shape: T) {
    return createResultSchema(z.object(shape));
}
