import { createHash } from "node:crypto";

import { redis } from "@/db.js";
import { logWarning } from "@/logging.js";

/**
 * Returns the value stored under `key` in Redis, or computes it with `compute` and stores it for `ttlSeconds`. A Redis
 * failure never fails the caller - it only costs it the cache.
 */
export async function cachedJson<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    try {
        const hit = await redis().get(key);
        if (hit !== null)
            return JSON.parse(hit) as T;
    }
    catch (err) {
        logWarning("Couldn't read from the Redis cache.", { err, key });
    }

    const value = await compute();

    try {
        await redis().set(key, JSON.stringify(value), "EX", ttlSeconds);
    }
    catch (err) {
        logWarning("Couldn't write to the Redis cache.", { err, key });
    }

    return value;
}

/**
 * A short, stable fingerprint of a secret, for keying caches on it without storing it.
 */
export function fingerprint(secret: string): string {
    return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}
