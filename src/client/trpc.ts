import { createTRPCClient, createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { createTRPCNext, withTRPC } from "@trpc/next";
import { CreateReactUtils } from "@trpc/react-query/shared";
import { NextPageContext } from "next";

import type { AppRouter } from "../server/routers/_app";

export type Api = CreateReactUtils<AppRouter, NextPageContext>;

function getBaseUrl() {
    if (typeof window !== "undefined") 
        return ""; // browser should use relative path

    if (process.env.VERCEL_URL)
        return `https://${process.env.VERCEL_URL}`; // reference for vercel.com

    if (process.env.RENDER_INTERNAL_HOSTNAME) // reference for render.com
        return `http://${process.env.RENDER_INTERNAL_HOSTNAME}:${process.env.PORT}`;
        
    // assume localhost
    return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const trpc = createTRPCProxyClient<AppRouter>({
    links: [
        httpBatchLink({
            /**
             * If you want to use SSR, you need to use the server"s full URL
             * @see https://trpc.io/docs/v11/ssr
             **/
            url: `${getBaseUrl()}/api/trpc`,
            // You can pass any HTTP headers you wish here
            async headers() {
                return {
                    // authorization: getAuthCookie(),
                };
            },
        }),
    ]
});

