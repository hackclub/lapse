import "dotenv/config";

import { realizeJobWorker } from "@/workers/realize.js";

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