import "../allow-only-server";

import { router } from "@/server/trpc";

import timelapse from "./api/timelapse";
import user from "./api/user";
import snapshot from "./api/snapshot";
import tracing from "./api/tracing";
import global from "./api/global";
import comment from "./api/comment";

export const appRouter = router({
    timelapse,
    user,
    snapshot,
    tracing,
    global,
    comment
});

// type definition of API
export type AppRouter = typeof appRouter;
