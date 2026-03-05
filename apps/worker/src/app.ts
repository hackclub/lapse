import "dotenv/config";

import { realizeJobWorker } from "@/workers/realize.js";

async function main() {
    console.log("⧗  Lapse (Background Worker) v2.0.0");

    await realizeJobWorker.run();

    console.log("   All workers started!");
}

main();