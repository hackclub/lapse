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

    return data
        .map(x => typeof x === "string" ? x : inlineJson(x))
        .join(" ")
        .trim();
}

export function logInfo(scope: string, ...data: unknown[]) {
    console.log(`(${scope}) info: ${dataToLogString(data)}`);
}

export function logWarning(scope: string, ...data: unknown[]) {
    console.warn(`(${scope}) warn: ${dataToLogString(data)}`);
}

export function logError(scope: string, ...data: unknown[]) {
    console.error(`(${scope}) error: ${dataToLogString(data)}`);
}
