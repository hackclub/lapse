import { z } from "zod";

/**
 * Represents the structure of a JSON API response. For local operations, see `Result<T>`.
 */
export type ApiResult<T> =
    { ok: true, data: T } |
    { ok: false, error: KnownError, message: string };

/**
 * Represents a successful local operation.
 */
export type Ok<T> = T extends Err ? never : T;

/**
 * Represents a failed local operation.
 */
export class Err {
    error: KnownError;
    message: string;

    constructor (error: KnownError, message: string) {
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
 * Represents errors that are shared between both the client and the server. These identifiers specify the exact
 * class of error that an `ApiResult<T>` *or* `Result<T>` describe.
 */
export type KnownError = z.infer<typeof KnownErrorSchema>;
export const KnownErrorSchema = z.enum([
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

export function createResultSchema<T extends z.ZodType>(dataSchema: T) {
    return z.discriminatedUnion("ok", [
        z.object({
            ok: z.literal(true),
            data: dataSchema
        }),

        z.object({
            ok: z.literal(false),
            error: KnownErrorSchema,
            message: z.string()
        })
    ]);
}

export function apiResult<T extends z.core.$ZodLooseShape>(shape: T) {
    return createResultSchema(z.object(shape));
}

/**
 * Returns an `ApiResult<T>` object that represents a successful API response.
 */
export function apiOk<T>(data: T) {
    return { ok: true as const, data };
}

/**
 * Returns an `ApiResult<T>` object that represents a failed API response.
 */
export function apiErr(error: KnownError, message: string) {
    return { ok: false as const, error, message };
}

/**
 * Throws an error if `condition` is `false`.
 */
export function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

/**
 * Creates an array like `[0, ..., length - 1]`.
 */
export function range(length: number) {
    return [...Array(length).keys()];
}

/**
 * Used as an ascending numeric sort function for a `T[]` with a key selector.
 * For example, `x.sort(descending(x => x.someNumber))`.
 */
export function ascending<T>(picker: (x: T) => number): (a: T, b: T) => number;

/**
 * Used as an ascending numeric sort function for a `number[]`. For example, `x.sort(descending())`.
 */
export function ascending(): (a: number, b: number) => number;

export function ascending<T>(picker?: (x: T) => number) {
    if (!picker)
        return (a: number, b: number) => a - b;

    return (a: T, b: T) => picker(a) - picker(b); 
}

/**
 * Used as a descending numeric sort function for a `T[]` with a key selector.
 * For example, `x.sort(descending(x => x.someNumber))`.
 */
export function descending<T>(picker: (x: T) => number): (a: T, b: T) => number;

/**
 * Used as a descending numeric sort function for a `number[]`. For example, `x.sort(descending())`.
 */
export function descending(): (a: number, b: number) => number;

export function descending<T>(picker?: (x: T) => number) {
    if (!picker)
        return (a: number, b: number) => b - a;

    return (a: T, b: T) => picker(b) - picker(a);
}

/**
 * Gets a string like `[object ArrayBuffer]` for the given object.
 */
export function typeName<T>(obj: T) {
    return Object.prototype.toString.call(obj);
}

/**
 * Throws an error when `obj` is not truthy.
 */
export function unwrap<T>(obj: T | undefined, apiErr?: string): T {
    if (obj)
        return obj;

    throw new Error(apiErr ?? "Object was undefined.");
}

/**
 * Emulates a `switch` expression present in languages like C#. For example:
 * 
 * ```
 * // 'result' will be equal to 420.
 * const result = match("c", {
 *      "a": 727,
 *      "b": 67,
 *      "c": 420,
 *      "d": 2137
 * });
 * ```
 */
export function match<K extends string | number, T>(selector: K, cases: Record<K, T>) {
    if (!(selector in cases)) {
        console.error("(common.ts) Could not find", selector, "from cases", cases);
        throw new Error(`Could not match value ${selector} in "match" block`);
    }

    return cases[selector];
}

/**
 * Emulates a `switch` expression present in languages like C#. Returns `null` if the selector
 * is not present in `cases`. For example:
 * 
 * ```
 * // 'result' will be equal to 12345678.
 * const result = match("meow", {
 *      "a": 727,
 *      "b": 67,
 *      "c": 420,
 *      "d": 2137
 * }) ?? 12345678;
 * ```
 */
export function matchOrDefault<K extends string, T>(selector: K, cases: Record<K, T>) {
    if (!(selector in cases))
        return null;

    return cases[selector];
}

/**
 * Transforms an array like `["a", "b"]` to an object like `{ a: true, b: true }`.
 * This function is usually used for expressions like `choice in oneOf("a", "b")`.
 */
export function oneOf<T extends PropertyKey>(...values: T[]): Record<T, true> {
    return Object.fromEntries(values.map(x => [x, true])) as Record<T, true>;
}

/**
 * Returns `value` when `condition` is `true` - otherwise, returns an empty object (`{}`).
 * This function is usually used for conditional object construction via the spread operator.
 */
export function when<T>(condition: boolean, value: T) {
    if (condition)
        return value;

    return {};
}

/**
 * Finds the closest number to `x` in `array`.
 */
export function closest(x: number, array: number[]): number;

/**
 * Finds the closest item to `x` in `array` using a selector function.
 */
export function closest<T>(x: number, array: T[], selector: (item: T) => number): T;

export function closest<T>(x: number, array: T[] | number[], selector?: (item: T) => number): T | number {
    if (selector) {
        const typedArray = array as T[];
        const match = typedArray.find(item => selector(item) === x);
        if (match) return match;

        return typedArray.reduce((prev, curr) => 
            Math.abs(selector(curr) - x) < Math.abs(selector(prev) - x) ? curr : prev
        );
    }
    
    const numberArray = array as number[];
    if (numberArray.find(y => x === y))
        return x;

    return numberArray.reduce((prev, curr) => Math.abs(curr - x) < Math.abs(prev - x) ? curr : prev);
}

/**
 * Equivalent to `array.slice`, but acts as a generator instead.
 */
export function* slicedView<T>(array: T[], start: number, end: number) {
    for (let i = start; i < end; i++) {
        yield array[i];
    }
}

/**
 * Generates a random number between `min` (inclusive) and `max` (exclusive).
 */
export function rng(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Similar to `rng`, but generates a floating-point number instead.
 */
export function frng(min: number, max: number) {
    return Math.random() * (max - min) + min;
}

/**
 * Picks a random element from the given array.
 */
export function pickRandom<T>(array: T[]) {
    return array[rng(0, array.length)];
}

/**
 * Creates an array of chunks of size `n` derived from `array`.
 * For example, an input of `( [1, 2, 3, 4, 5], 2 )` yields `[1, 2], [3, 4], [5]`.
 */
export function* chunked<T>(array: T[], n: number) {
    for (let i = 0; i < array.length; i += n) {
        yield array.slice(i, i + n);
    }
}

/**
 * Represents an empty object (`{}`).
 */
export type Empty = Record<string, never>;

/**
 * Returns `true` if `obj` is an array with at least one element.
 */
export function isNonEmptyArray(obj: unknown): obj is unknown[] {
    return Array.isArray(obj) && obj.length != 0;
}

/**
 * Returns a one-element array when `condition` is `true` - otherwise, returns `[]`.
 */
export function maybe<T>(element: T, condition: boolean) {
    return condition ? [element] as const : [] as const;
}

/**
 * Returns a `Date` equal to the current date, `days` days ago.
 */
export function daysAgo(days: number) {
    const now = new Date();
    now.setDate(now.getDate() - days);
    return now;
}

function extractTimespanComponents(seconds: number) {
    seconds = Math.floor(seconds);

    return {
        h: Math.floor(seconds / 3600),
        m: Math.floor((seconds % 3600) / 60),
        s: seconds % 60
    };
}

function extractDateComponents(seconds: number) {
  seconds = Math.floor(seconds);

  const years = Math.floor(seconds / 31557600); // 365.25 days
  seconds %= 31557600;

  const months = Math.floor(seconds / 2629746); // ~30.44 days
  seconds %= 2629746;

  const weeks = Math.floor(seconds / 604800);
  seconds %= 604800;

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return {
    y: years,
    mo: months,
    w: weeks,
    d: days,
    h: hours,
    m: minutes,
    s: seconds
  };
}

/**
 * Formats a duration, represented in the form of a number of seconds, to a string like `3h 2m`.
 */
export function formatDuration(seconds: number) {
    if (seconds == 0)
        return "0s";

    const { h, m, s } = extractTimespanComponents(seconds);

    return [
        ...maybe(`${h}h`, h != 0),
        ...maybe(`${m}m`, m != 0),
        ...maybe(`${s}s`, s != 0)
    ].join(" ");
}

/**
 * Formats a date in the past to a string like `3 minutes ago`.
 */
export function formatTimeElapsed(date: Date) {
    const secondsPast = (new Date().getTime() - date.getTime()) / 1000;
    const { y, mo, d, h, m, s } = extractDateComponents(secondsPast);

    return (
        (y >= 1) ? `${y} year${y > 1 ? 's' : ''} ago` :
        (mo >= 1) ? `${mo} month${mo > 1 ? 's' : ''} ago` :
        (d >= 1) ? `${d} day${d > 1 ? 's' : ''} ago` :
        (h >= 1) ? `${h} hour${h > 1 ? 's' : ''} ago` :
        (m >= 1) ? `${m} minute${m > 1 ? 's' : ''} ago` :
        (s <= 1) ? "just now" :
        `${s} second${s > 1 ? 's' : ''} ago`
    );
}

/**
 * Checks if the given URL is valid.
 */
export function validateUrl(url: string) {
    try {
        if (!url.trim())
            return true;
        
        new URL(url.trim());
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Returns a Promise that resolves in `ms` milliseconds.
 */
export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

type UnionToIntersection<U> = (U extends any
    ? (k: U) => void
    : never) extends ((k: infer I) => void)
    ? I
    : never;

/**
 * Flattens multiple union types into a single type with optional values.
 */
export type FlattenUnion<T> = {
    [K in keyof UnionToIntersection<T>]: K extends keyof T ?
    T[K] extends any[] ? T[K]
    : T[K] extends object ? FlattenUnion<T[K]>
    : T[K]
    : UnionToIntersection<T>[K] | undefined
}