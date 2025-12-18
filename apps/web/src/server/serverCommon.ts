import * as Sentry from "@sentry/nextjs";
import type { NextApiRequest } from "next";
import { inspect } from "node:util";

import * as db from "@/generated/prisma/client";

function inlineStringify(x: unknown) {
    return inspect(x, {
        breakLength: Infinity,
        compact: true,
        maxArrayLength: 10,
        sorted: true
    });
}

function dataToLogString(data: unknown[]) {
    function stringify(x: unknown) {
        if (typeof x === "string")
            return x;

        if (x instanceof Error)
            return `\t${x.stack?.replaceAll("\n", "\n\t") ?? `${x.name}: ${x.message}`}`;

        return inlineStringify(x);
    }

    return data.map(stringify).join("\n    ").trim();
}

function getPlain(severity: string, scope: string, message: string, data: Record<string, unknown>) {
    const prefix = `(${severity}) ${scope}:`;

    const stringified = dataToLogString(
        [ message, ...Object.entries(data).map(x => `${x[0]}: ${inlineStringify(x[1])}`) ]
    ).replaceAll("\n", `\n${prefix} `);

    return `${prefix} ${stringified}`;
}

function remapData(data: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(data)
            .flatMap(([k, v]) => {
                // Apparently, when we log an Error to Sentry, the field is always empty.
                if (v instanceof Error) {
                    return [
                        [`${k}_name`, v.name],
                        [`${k}_message`, v.message],
                        [`${k}_cause`, v.cause],
                        [`${k}_stack`, v.stack]
                    ];
                }

                return [[k, v]];
            })
            .map(([k, v]) => [`lapse_${k}`, v])
    );
}

export function logTracing(scope: string, data: Record<string, unknown> = {}) {
    Sentry.logger.trace(`TRACING: (${scope})`, remapData(data));
}

export function logInfo(scope: string, message: string, data: Record<string, unknown> = {}) {
    console.log(getPlain("info", scope,  message, data));
    Sentry.logger.info(`(${scope}) ${message}`, remapData(data));
}

export function logWarning(scope: string, message: string, data: Record<string, unknown> = {}) {
    console.warn(getPlain("warn", scope,  message, data));
    Sentry.logger.warn(`(${scope}) ${message}`, remapData(data));
}

export function logError(scope: string, message: string, data: Record<string, unknown> = {}) {
    console.error(getPlain("error", scope,  message, data));
    Sentry.logger.error(`(${scope}) ${message}`, remapData(data));
}

type PartialTRPCRequest = {
    input: Record<string, unknown>;
    ctx: {
        user: db.User | null
    }
};

export function logRequest(endpoint: string, req: PartialTRPCRequest) {
    Sentry.logger.info(`(request) ${endpoint}`, {
        input: req.input,
        user: req.ctx.user
    });

    console.log(getPlain("info", "request", endpoint, { user: req.ctx.user, args: req.input }));
}

export function logNextRequest(endpoint: string, req: NextApiRequest) {
    Sentry.logger.info(`(request) ${endpoint}`, { req });
    console.log(getPlain("info", "request", endpoint, { url: req.url }));
}
