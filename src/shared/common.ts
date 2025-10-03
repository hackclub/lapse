import { z } from "zod";

export function createResultSchema<T extends z.ZodType>(dataSchema: T) {
    return z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), data: dataSchema }),
        z.object({ ok: z.literal(false), error: z.string() })
    ]);
}

export function apiResult<T extends z.core.$ZodLooseShape>(shape: T) {
    return createResultSchema(z.object(shape));
}

export function ok<T>(data: T) {
    return { ok: true as const, data };
}

export function err(message: string) {
    return { ok: false as const, error: message };
}

export function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

export function range(length: number) {
    return [...Array(length).keys()];
}

export function ascending<T>(picker: (x: T) => number) {
    return (a: T, b: T) => picker(a) - picker(b); 
}

export function descending<T>(picker: (x: T) => number) {
    return (a: T, b: T) => picker(b) - picker(a);
}

export function typeName<T>(obj: T) {
    return Object.prototype.toString.call(obj);
}