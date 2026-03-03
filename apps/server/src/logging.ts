import type { FastifyRequest } from "fastify";
import * as Sentry from "@sentry/node";
import * as path from "node:path";
import { inspect, getCallSites } from "node:util";

import * as db from "@/generated/prisma/client.js";

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

export function logTracing(data: Record<string, unknown> = {}) {
    Sentry.logger.trace(`TRACING: (${getScope()})`, remapData(data));
}

function getScope() {
    const callSite = getCallSites(3)[2];
    return callSite ? `${path.basename(callSite.scriptName, path.extname(callSite.scriptName))}::${callSite.functionName}` : "";
}

export function logInfo(message: string, data: Record<string, unknown> = {}) {
    const scope = getScope();
    
    console.log(getPlain("info", scope, message, data));
    Sentry.logger.info(`(${scope}) ${message}`, remapData(data));
}

export function logWarning(message: string, data: Record<string, unknown> = {}) {
    const scope = getScope();
    console.warn(getPlain("warn", scope,  message, data));
    Sentry.logger.warn(`(${scope}) ${message}`, remapData(data));
}

export function logError(message: string, data: Record<string, unknown> = {}) {
    const scope = getScope();
    console.error(getPlain("error", scope,  message, data));
    Sentry.logger.error(`(${scope}) ${message}`, remapData(data));
}

export function logRequest(endpoint: string, input: unknown, user: db.User | null) {
    Sentry.logger.info(`(request) ${endpoint}`, { input, user });
    console.log(getPlain("info", "request", `${endpoint}(${inlineStringify(input)}) from ${user?.handle ?? "<anon>"}`, {}));
}

export function logFastifyRequest(endpoint: string, req: FastifyRequest) {
    Sentry.logger.info(`(request) ${endpoint}`, { req });
    console.log(getPlain("info", "request", endpoint, { url: req.url }));
}
