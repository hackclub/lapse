import * as Sentry from "@sentry/node";
import * as path from "node:path";
import { inspect, getCallSites } from "node:util";

import * as db from "@/generated/prisma/client.js";
import type { ExternalActor } from "@/ownership.js";

// Logs go to stdout and to Sentry, both of which far more people can read than the database. Anything that would let a
// reader act as a user - our tokens, Hackatime's, device keys, OAuth codes, passwords - is blanked out before either.
const SENSITIVE_KEY = /token|secret|password|passkey|devicekey|verifier|authorization|cookie|apikey|api_key|hash$|^code$|^key$/i;
const MAX_REDACT_DEPTH = 8;

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
    if (value instanceof Error)
        return redactError(value, depth, seen);

    if (typeof value !== "object" || value === null || value instanceof Date)
        return value;

    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
        return `[${value.byteLength} bytes]`;

    if (seen.has(value) || depth >= MAX_REDACT_DEPTH)
        return "[omitted]";

    seen.add(value);

    if (Array.isArray(value))
        return value.map(item => redact(item, depth + 1, seen));

    return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) && v != null ? "[redacted]" : redact(v, depth + 1, seen)])
    );
}

/**
 * Errors carry whatever their thrower attached - oRPC's validation errors hold the raw request input, headers and all -
 * and `inspect` prints every bit of it. This copies the error with those properties (and its cause) redacted, keeping
 * its class, message and stack, so it still logs and reports as the error it was.
 */
function redactError(err: Error, depth: number, seen: WeakSet<object>): Error {
    if (seen.has(err) || depth >= MAX_REDACT_DEPTH)
        return err;

    seen.add(err);

    const copy = Object.create(Object.getPrototypeOf(err) as object) as Error;
    for (const property of ["name", "message", "stack"] as const) {
        if (Object.hasOwn(err, property))
            Object.defineProperty(copy, property, { value: err[property], writable: true, configurable: true, enumerable: false });
    }

    // An error's own `code` is what went wrong (`BAD_REQUEST`, `P2002`), never an OAuth code.
    for (const [k, v] of Object.entries(err)) {
        const sensitive = k !== "code" && SENSITIVE_KEY.test(k) && v != null;
        Object.defineProperty(copy, k, { value: sensitive ? "[redacted]" : redact(v, depth + 1, seen), writable: true, configurable: true, enumerable: true });
    }

    if (err.cause !== undefined)
        Object.defineProperty(copy, "cause", { value: redact(err.cause, depth + 1, seen), writable: true, configurable: true, enumerable: false });

    return copy;
}

function redactData(data: Record<string, unknown>): Record<string, unknown> {
    return redact(data) as Record<string, unknown>;
}

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
        [ message, ...Object.entries(redactData(data)).map(x => `${x[0]}: ${inlineStringify(x[1])}`) ]
    ).replaceAll("\n", `\n${prefix} `);

    let colorPrefix = process.env["NODE_ENV"] !== "development" ? "" :
        severity == "warn" ? "\x1b[33m" :
        severity == "error" ? "\x1b[31m" :
        "";

    return `${colorPrefix}${prefix} ${stringified}${colorPrefix == "" ? "" : "\x1b[0m"}`;
}

function remapData(data: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(redactData(data))
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
    captureIssue(scope, message, data);
}

/**
 * Turns an error log into a Sentry issue, so it gets grouped and alerted on rather than sitting in the log stream.
 * The first `Error` in `data` supplies the stack trace; without one, the message itself becomes the issue.
 */
function captureIssue(scope: string, message: string, data: Record<string, unknown>) {
    const error = Object.values(data).find(x => x instanceof Error);
    const extra = Object.fromEntries(Object.entries(redactData(data)).filter(([, v]) => v !== error));

    Sentry.withScope(sentryScope => {
        sentryScope.setTag("lapse_scope", scope);
        sentryScope.setContext("lapse", { message, ...extra });

        if (error)
            Sentry.captureException(error);
        else
            Sentry.captureMessage(`(${scope}) ${message}`, "error");
    });
}

function describeActor(actor: ExternalActor | null) {
    if (!actor)
        return null;

    return actor.kind == "USER"
        ? { kind: actor.kind, id: actor.user.id, handle: actor.user.handle }
        : { kind: actor.kind, programKey: actor.programKey.name };
}

export function logRequest(endpoint: string, input: unknown, actor: ExternalActor | null) {
    const safeInput = redact(input);
    Sentry.logger.info(`(request) ${endpoint}`, { input: safeInput, actor: describeActor(actor) });
    console.log(getPlain("info", "request", `${endpoint}(${inlineStringify(safeInput)}) from ${actor ? (actor.kind == "USER" ? `@${actor.user.handle}` : actor.programKey.name) : "<anon>"}`, {}));
}
