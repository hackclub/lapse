import type { LapseError } from "@hackclub/lapse-api";
import { nanoid } from "nanoid";

/**
 * Returns an `LapseResult<T>` object that represents a successful API response.
 */
export function apiOk<T>(data: T) {
    return { ok: true as const, data };
}

/**
 * Returns an `LapseResult<T>` object that represents a failed API response.
 */
export function apiErr(error: LapseError, message: string) {
    return { ok: false as const, error, message };
}

/**
 * Represents a successful local operation.
 */
export type Ok<T> = T extends Err ? never : T;

/**
 * Represents a failed local operation.
 */
export class Err {
    error: LapseError;
    message: string;

    constructor (error: LapseError, message: string) {
        this.error = error;
        this.message = message;
    }

    toApiError() {
        return apiErr(this.error, this.message);
    }
}

/**
 * Represents a local operation. For API responses, see `ApiResult<T>`.
 */
export type Result<T> = Ok<T> | Err;

/**
 * Generates a new `LapseId` - a 12-character-long NanoID.
 */
export function lapseId() {
    return nanoid(12);
}