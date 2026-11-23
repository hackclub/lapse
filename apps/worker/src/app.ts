import "dotenv/config";

import * as Sentry from "@sentry/node";
import { realizeJobWorker } from "@/workers/realize.js";
import { env } from "@/env.js";

if (env.SENTRY_DSN) {
    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: process.env["NODE_ENV"] ?? "development",
        release: env.SOURCE_COMMIT,
        tracesSampleRate: 0,
        integrations: [
            Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] })
        ]
    });
}

// Job data carries the legacy device key, so only identifiers go along with the error - never the job itself.
realizeJobWorker.on("failed", (job, err) => {
    Sentry.withScope(scope => {
        scope.setTag("lapse_jobName", job?.name ?? "unknown");
        scope.setTag("lapse_jobId", job?.id ?? "unknown");
        scope.setTag("lapse_timelapseId", job?.data.timelapseId ?? "unknown");
        Sentry.captureException(err);
    });

    // A finished job carries no key in Redis (it's removed), but a failed one is kept so the server can mark its
    // timelapse as failed - and with it the key, for as long as the job lingers. Retries still need it, so it's only
    // blanked once the last attempt has failed.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        job.updateData({ ...job.data, passkey: "<REDACTED>" })
            .catch((updateErr: unknown) => console.warn(`Couldn't scrub the device key from failed job ${job.id}.`, updateErr));
    }
});

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