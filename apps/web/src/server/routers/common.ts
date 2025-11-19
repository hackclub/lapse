import z from "zod";

/**
 * A 12-character Nano ID, used to represent all public entities.
 */
export const PublicId = z.string();

/**
 * Represents a timestamp, measured in milliseconds, since the UNIX epoch. This represents all
 * dates for the API.
 */
export const ApiDate = z.number().nonnegative();
