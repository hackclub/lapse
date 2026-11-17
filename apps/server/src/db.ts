import { PrismaPg } from "@prisma/adapter-pg";
import { Redis } from "ioredis";

import { PrismaClient } from "@/generated/prisma/client.js";
import { env } from "@/env.js";
import { logInfo, logWarning } from "@/logging.js";

let _database: PrismaClient | null = null;
let _redis: Redis | null = null;

export function database(): PrismaClient {
    if (!_database)
        throw new Error("Attempted to access the database before initialization.");

    return _database;
}

export function redis(): Redis {
    if (!_redis) {
        _redis = new Redis(env.REDIS_URL, {
            maxRetriesPerRequest: null,
            // ioredis 6 defaults to RESP3; keep RESP2 until Redis/BullMQ soak tests pass
            protocol: 2,
        });
        logInfo("Successfully connected to Redis.");
    }

    return _redis;
}

export function initDatabase() {
    if (_database)
        throw new Error("Attempted to initialize the database twice.");

    // Opening a connection to our Postgres takes ~1.5s, against single-digit milliseconds for a query on an open one.
    // pg's defaults (no floor, idle connections closed after 10s) made every burst after a quiet spell pay that on
    // each request, so a floor of connections is kept open for good and extras linger for a few minutes.
    const adapter = new PrismaPg({
        connectionString: env.DATABASE_URL,
        max: DATABASE_POOL_MAX,
        min: DATABASE_POOL_MIN,
        idleTimeoutMillis: 5 * 60_000,
        keepAlive: true,
    });

    _database = new PrismaClient({ adapter });
    logInfo("Successfully connected to the database.");

    void warmDatabasePool();
}

const DATABASE_POOL_MAX = 10;
const DATABASE_POOL_MIN = 4;

/**
 * pg only opens connections on demand, so the pool's floor is filled up front rather than by the first users.
 */
async function warmDatabasePool() {
    try {
        await Promise.all(
            Array.from({ length: DATABASE_POOL_MIN }, () => database().$queryRaw`SELECT pg_sleep(0.05)::text`)
        );
    }
    catch (err) {
        logWarning("Couldn't warm the database connection pool.", { err });
    }
}

