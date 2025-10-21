function requiredEnv(key: string) {
    const value = process.env[key];
    if (value)
        return value;

    throw new Error(`The environment variable ${key} is missing.`);
}

/**
 * The URL passed to `ioredis`.
 */
export const REDIS_URL = requiredEnv("REDIS_URL");