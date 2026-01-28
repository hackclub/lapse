import { createTRPCProxyClient, httpBatchLink, TRPCClientError, TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { CreateReactUtils } from "@trpc/react-query/shared";
import { NextPageContext } from "next";

import type { AppRouter } from "@/server/routers/_app";

export type Api = CreateReactUtils<AppRouter, NextPageContext>;

let banRedirectTriggered = false;

function triggerBanRedirect() {
    if (!banRedirectTriggered && typeof window !== "undefined") {
        banRedirectTriggered = true;
        window.location.href = "/banned";
    }
}

export function isBannedError(error: unknown): boolean {
    return error instanceof TRPCClientError && error.message === "BANNED";
}

const banCheckLink: TRPCLink<AppRouter> = () => {
    return ({ next, op }) => {
        return observable((observer) => {
            const unsubscribe = next(op).subscribe({
                next(value) {
                    observer.next(value);
                },
                error(err) {
                    if (isBannedError(err)) {
                        triggerBanRedirect();
                    }
                    observer.error(err);
                },
                complete() {
                    observer.complete();
                },
            });
            return unsubscribe;
        });
    };
};

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
        banCheckLink,
        httpBatchLink({
            url: `${getBaseUrl()}/api/trpc`,
            async headers() {
                return {};
            },
        }),
    ]
});

