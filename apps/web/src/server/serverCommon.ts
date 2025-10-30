import * as db from "@/generated/prisma";
import * as Sentry from "@sentry/nextjs";
import type { NextApiRequest } from "next";

function inlineJson(x: unknown) {
    return JSON.stringify(x, (k, v) => {
        if (v instanceof Array) {
            const MAX_LENGTH = 10;

            if (v.length > MAX_LENGTH)
                return [...v.slice(0, MAX_LENGTH), `(...${v.length - MAX_LENGTH} more)`];

            return v;
        }

        return v;
    }, 1)
        .replaceAll("\n", " ")
        .replace(/ +/g, " ")
        .replace(/"([A-Za-z0-9_$]+)":/g, "$1:");
}

function dataToLogString(data: unknown[]) {
    function stringify(x: unknown) {
        if (typeof x === "string")
            return x;

        if (x instanceof Error)
            return `\t${x.stack?.replaceAll("\n", "\n\t") ?? `${x.name}: ${x.message}`}`;

        return inlineJson(x);
    }

    return data.map(stringify).join("\n    ").trim();
}

function getPlain(severity: string, scope: string, message: string, data: Record<string, unknown>) {
    const prefix = `(${severity}) ${scope}:`;

    const stringified = dataToLogString(
        [ message, ...Object.entries(data).map(x => `${x[0]}: ${inlineJson(x[1])}`) ]
    ).replaceAll("\n", `\n${prefix} `);

    return `${prefix} ${stringified}`;
}

function remapData(data: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(data)
            .map(x => [`lapse_${x[0]}`, x[1]])
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
