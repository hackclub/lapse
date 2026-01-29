import "@/server/allow-only-server";

import { router } from "@/server/trpc";

import timelapse from "@/server/routers/api/timelapse";
import user from "@/server/routers/api/user";
import snapshot from "@/server/routers/api/snapshot";
import tracing from "@/server/routers/api/tracing";
import global from "@/server/routers/api/global";
import comment from "@/server/routers/api/comment";
import hackatime from "@/server/routers/api/hackatime";

export const appRouter = router({
    timelapse,
    user,
    snapshot,
    tracing,
    global,
    comment,
    hackatime
});

// type definition of API
export type AppRouter = typeof appRouter;
