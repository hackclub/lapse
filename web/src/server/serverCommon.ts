import * as db from "@/generated/prisma";

import { getLogContent } from "@../common/logging";

export function logInfo(scope: string, ...data: unknown[]) {
    console.log(getLogContent("info", scope, ...data));
}

export function logWarning(scope: string, ...data: unknown[]) {
    console.warn(getLogContent("warn", scope, ...data));
}

export function logError(scope: string, ...data: unknown[]) {
    console.error(getLogContent("error", scope, ...data));
}

type PartialTRPCRequest = {
    input: Record<string, unknown>;
    ctx: {
        user: db.User | null
    }
};

export function logRequest(endpoint: string, req: PartialTRPCRequest) {
    console.log(getLogContent("request", endpoint, ...[
        `${req.ctx.user ? `@${req.ctx.user.handle}` : "?"} ->`,
        req.input
    ]));
}