import "../allow-only-server";

import { router } from "../trpc";

import timelapse from "./api/timelapse";
import user from "./api/user";
import snapshot from "./api/snapshot";
import tracing from "./api/tracing";
import global from "./api/global";

export const appRouter = router({
    timelapse,
    user,
    snapshot,
    tracing,
    global
});

// type definition of API
export type AppRouter = typeof appRouter;
