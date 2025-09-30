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