import "dotenv/config";

import { realizeJobWorker } from "@/workers/realize.js";

async function main() {
    console.log("⧗  Lapse (Background Worker) v2.0.0");
    console.log(`   * started on ${new Date().toUTCString()}`);

    await realizeJobWorker.run();

    console.log("   * all workers running!");
}

main();