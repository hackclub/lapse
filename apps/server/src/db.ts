import { PrismaPg } from "@prisma/adapter-pg";
import { Redis } from "ioredis";

import { PrismaClient } from "@/generated/prisma/client.js";
import { env } from "@/env.js";
import { logInfo } from "@/logging.js";

let _database: PrismaClient | null = null;
let _redis: Redis | null = null;

export function database(): PrismaClient {
    if (!_database)
        throw new Error("Attempted to access the database before initialization.");

    return _database;
}

export function redis(): Redis {
    if (!_redis)
        throw new Error("Attempted to access the Redis connection before initialization.");

    return _redis;
}

export function initDatabase() {
    if (_database)
        throw new Error("Attempted to initialize the database twice.");

    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
    _database = new PrismaClient({ adapter });

    logInfo("Successfully connected to the database.");
}

export function initRedis() {
    if (_redis)
        throw new Error("Attempted to initialize the Redis connection twice.");

    _redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

    logInfo("Successfully connected to Redis.");
}

