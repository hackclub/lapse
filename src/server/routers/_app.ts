import { router } from "../trpc";

import timelapse from "./api/timelapse";
import user from "./api/user";

export const appRouter = router({
    timelapse,
    user
});

// type definition of API
export type AppRouter = typeof appRouter;
