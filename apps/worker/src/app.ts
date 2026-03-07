import "dotenv/config";

import * as Sentry from "@sentry/node";
import { realizeJobWorker } from "@/workers/realize.js";
import { env } from "@/env.js";

if (env.SENTRY_DSN) {
    Sentry.init({
        dsn: env.SENTRY_DSN,
        tracesSampleRate: 1,
        enableLogs: true
    });
}

async function main() {
    console.log("⧗  Lapse (Background Worker) v2.0.0");
    console.log(`*  started on ${new Date().toUTCString()}`);

    const workers = [
        realizeJobWorker.run()
    ];

    console.log(`*  all ${workers.length} workers running!`);
    await Promise.all(workers);
}

main();