import { Redis } from "ioredis";

import { env } from "@/env.js";

export const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    // ioredis 6 defaults to RESP3; keep RESP2 until Redis/BullMQ soak tests pass
    protocol: 2,
});
