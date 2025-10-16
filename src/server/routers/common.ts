import z from "zod";

/**
 * A 12-character Nano ID, used to represent all public entities.
 */
export const PublicId = z.string();
