import * as db from "@/generated/prisma";

function dataToLogString(data: unknown[]) {
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

    function stringify(x: unknown) {
        if (typeof x === "string")
            return x;

        if (x instanceof Error)
            return `\t${x.stack?.replaceAll("\n", "\n\t") ?? `${x.name}: ${x.message}`}`;

        return inlineJson(x);
    }

    return data.map(stringify).join(" ").trim();
}

function getLogContent(severity: string, scope: string, ...data: unknown[]) {
    const prefix = `(${severity}) ${scope}:`;
    const stringified = dataToLogString(data).replaceAll("\n", `\n${prefix} `);
    return `${prefix} ${stringified}`;
}

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