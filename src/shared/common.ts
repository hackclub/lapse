import { z } from "zod";

/**
 * Represents the structure of a JSON API response.
 */
export type ApiResult<T> =
    { ok: true, data: T } |
    { ok: false, error: ApiError, message: string };

export type ApiError = z.infer<typeof ApiErrorSchema>;
export const ApiErrorSchema = z.enum([
    "ERROR",
    "NOT_FOUND",
    "DEVICE_NOT_FOUND",
    "NOT_MUTABLE",
    "MISSING_PARAMS",
    "SIZE_LIMIT",
    "NO_PERMISSION",
    "HACKATIME_ERROR",
    "ALREADY_PUBLISHED",
    "NO_FILE"
]);

export function createResultSchema<T extends z.ZodType>(dataSchema: T) {
    return z.discriminatedUnion("ok", [
        z.object({
            ok: z.literal(true),
            data: dataSchema
        }),

        z.object({
            ok: z.literal(false),
            error: ApiErrorSchema,
            message: z.string()
        })
    ]);
}

export function apiResult<T extends z.core.$ZodLooseShape>(shape: T) {
    return createResultSchema(z.object(shape));
}

export function ok<T>(data: T) {
    return { ok: true as const, data };
}

export function err(error: ApiError, message: string) {
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
export function unwrap<T>(obj: T | undefined, err?: string): T {
    if (obj)
        return obj;

    throw new Error(err ?? "Object was undefined.");
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
        console.error("Could not find", selector, "from cases", cases);
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
 * Creates an array of chunks of size `n` derived from `array`.
 * For example, an input of `( [1, 2, 3, 4, 5], 2 )` yields `[1, 2], [3, 4], [5]`.
 */
export function* chunked<T>(array: T[], n: number) {
    for (let i = 0; i < array.length; i += n) {
        yield array.slice(i, i + n);
    }
}

export type Ok<T> = { ok: true, value: T };
export type Err = { ok: false, error: string };
export type Result<T> = Ok<T> | Err;

/**
 * Represents an empty object (`{}`).
 */
export type Empty = Record<string, never>;