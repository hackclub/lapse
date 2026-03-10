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

    let colorPrefix = process.env["NODE_ENV"] !== "development" ? "" :
        severity == "warn" ? "\x1b[33m" :
        severity == "error" ? "\x1b[31m" :
        "";

    return `${colorPrefix}${prefix} ${stringified}${colorPrefix == "" ? "" : "\x1b[0m"}`;
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
    const callSites = getCallSites();
    
    // First, try to find a call site with both script and function name, not internal.
    let callSite = callSites.find(x => {
        const scriptName = x.scriptName.trim();
        const functionName = x.functionName.trim();
        if (scriptName === "" || functionName === "")
            return false;

        const basename = path.basename(scriptName, path.extname(scriptName));
        const isInternal = basename === "logging" || basename === "task_queues" || basename === "index";
        return !isInternal;
    });

    // Second, try to find a call site with either script or function name, not internal.
    if (!callSite) {
        callSite = callSites.find(x => {
            const scriptName = x.scriptName.trim();
            const functionName = x.functionName.trim();
            if (scriptName === "" && functionName === "")
                return false;

            const basename = path.basename(scriptName, path.extname(scriptName));
            const isInternal = basename === "logging" || basename === "task_queues" || basename === "index";
            return !isInternal;
        });
    }

    // Third, use the 3rd call site.
    if (!callSite) {
        callSite = callSites[2];
    }

    if (!callSite)
        return ""; // nothing worked!

    const scriptName = path.basename(callSite.scriptName, path.extname(callSite.scriptName)).trim();
    const functionName = callSite.functionName.trim();

    return (
        (scriptName && functionName) ? `${scriptName}::${functionName}`
        : (scriptName) ? scriptName
        : (functionName) ? functionName
        : ""
    );
}

export function logInfo(message: string, data: Record<string, unknown> = {}) {
    const scope = getScope();
    
    console.log(getPlain("info", scope, message, data));
    Sentry.logger.info(`(${scope}) ${message}`, remapData(data));
}

export function logWarning(message: string, data: Record<string, unknown> = {}) {
    const scope = getScope();
    console.warn(getPlain("warn", scope, message, data));
    Sentry.logger.warn(`(${scope}) ${message}`, remapData(data));
}

export function logError(message: string, data: Record<string, unknown> = {}) {
    const scope = getScope();
    console.error(getPlain("error", scope, message, data));
    Sentry.logger.error(`(${scope}) ${message}`, remapData(data));
}

export function logRequest(endpoint: string, input: unknown, user: db.User | null) {
    Sentry.logger.info(`(request) ${endpoint}`, { input, user });
    console.log(getPlain("info", "request", `${endpoint}(${inlineStringify(input)}) from ${user ? `@${user.handle}` : "<anon>"}`, {}));
}

export function logFastifyRequest(endpoint: string, req: FastifyRequest) {
    Sentry.logger.info(`(request) ${endpoint}`, { req });
    console.log(getPlain("info", "request", endpoint, { url: req.url }));
}
