import { z } from "zod";

export type ApiError = z.infer<typeof ApiErrorSchema>;
export const ApiErrorSchema = z.enum([
    "ERROR",
    "NOT_FOUND",
    "DEVICE_NOT_FOUND",
    "NOT_MUTABLE",
    "MISSING_PARAMS",
    "SIZE_LIMIT",
    "NO_PERMISSION",
    "HACKATIME_ALREADY_ASSIGNED",
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

export function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

export function range(length: number) {
    return [...Array(length).keys()];
}

/**
 * Creates a function which can be used with `.toSorted` and `.sort` that sorts a collection
 * in ascending order according to a numeric key.
 */
export function ascending<T>(picker: (x: T) => number): (a: T, b: T) => number;

/**
 * Creates a function which can be used with `.toSorted` and `sort` that sorts a numeric collection
 * in ascending order.
 */
export function ascending(): (a: number, b: number) => number;

export function ascending<T>(picker?: (x: T) => number) {
    if (!picker)
        return (a: number, b: number) => a - b;

    return (a: T, b: T) => picker(a) - picker(b); 
}

export function descending<T>(picker: (x: T) => number): (a: T, b: T) => number;
export function descending(): (a: number, b: number) => number;

export function descending<T>(picker?: (x: T) => number) {
    if (!picker)
        return (a: number, b: number) => b - a;

    return (a: T, b: T) => picker(b) - picker(a);
}

export function typeName<T>(obj: T) {
    return Object.prototype.toString.call(obj);
}

export function unwrap<T>(obj: T | undefined, err?: string): T {
    if (obj)
        return obj;

    throw new Error(err ?? "Object was undefined.");
}

/**
 * Emulates a `switch` expression present in languages like C#.
 */
export function match<K extends string, T>(selector: K, cases: Record<K, T>) {
    if (!(selector in cases)) {
        console.error("Could not find", selector, "from cases", cases);
        throw new Error(`Could not match value ${selector} in "match" block`);
    }

    return cases[selector];
}

export function oneOf<T extends PropertyKey>(...values: T[]): Record<T, true> {
    return Object.fromEntries(values.map(x => [x, true])) as Record<T, true>;
}

export function when<T>(condition: boolean, value: T) {
    if (condition)
        return value;

    return {};
}