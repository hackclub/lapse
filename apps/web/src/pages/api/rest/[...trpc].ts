import { createOpenApiNextHandler } from "trpc-to-openapi";

import { appRouter } from "@/server/routers/_app";
import { getRestAuthContext } from "@/server/auth";

export default createOpenApiNextHandler({
    router: appRouter,
    responseMeta: undefined,

    async createContext({ req, res }) {
        const authContext = await getRestAuthContext(req);
        return {
            req,
            res,
            user: authContext.user,
            scopes: authContext.scopes
        };
    },

    onError({ error }) {
        console.error("(REST API)", error);
    },
});
