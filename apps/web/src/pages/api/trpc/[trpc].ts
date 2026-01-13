import * as Sentry from "@sentry/nextjs";
import * as trpcNext from "@trpc/server/adapters/next";

import { appRouter } from "@/server/routers/_app";
import { createContext } from "@/server/trpc";
import { logError } from "@/server/serverCommon";

// export API handler
// @link https://trpc.io/docs/v11/server/adapters
export default trpcNext.createNextApiHandler({
    router: appRouter,
    createContext,
    onError({ path, error }) {
        logError("trpc", `error for ${path ?? "unknown"}! ${error.message}`, {
            code: error.code,
            cause: error.cause
        });

        Sentry.captureException(error, {
            extra: {
                path,
                code: error.code,
            },
        });
    },
});
