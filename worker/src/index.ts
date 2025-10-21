import { Worker } from "bullmq";
import IORedis from "ioredis";

import { getLogContent } from "@../common/logging";
import * as env from "./env";

import { combineVideo, COMBINE_VIDEO_QUEUE_NAME } from "./workers/combineVideo";

const connection = new IORedis(env.REDIS_URL);

function register<TArgs, TReturn>(worker: Worker<TArgs, TReturn>) {
    worker.on("completed", (job) => {
        console.log(getLogContent("ok", worker.name, ...[`job ${job.name} finished with`, job.returnvalue]));
    })

    worker.on("error", (err) => {
        console.error(getLogContent("error", worker.name, err));
    });

    worker.on("ready", () => {
        console.log(getLogContent("ok", worker.name, "worker is ready!"));
    });
}

register(new Worker(COMBINE_VIDEO_QUEUE_NAME, combineVideo, { connection }));
