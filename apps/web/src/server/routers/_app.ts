import "@/server/allow-only-server";

import { router } from "@/server/trpc";

import admin from "@/server/routers/api/admin";
import timelapse from "@/server/routers/api/timelapse";
import user from "@/server/routers/api/user";
import snapshot from "@/server/routers/api/snapshot";
import tracing from "@/server/routers/api/tracing";
import global from "@/server/routers/api/global";
import comment from "@/server/routers/api/comment";

export const appRouter = router({
    admin,
    timelapse,
    user,
    snapshot,
    tracing,
    global,
    comment
});

// type definition of API
export type AppRouter = typeof appRouter;
