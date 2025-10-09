export function logInfo(scope: string, ...data: unknown[]) {
    console.log(...[`(${scope}) info:`, ...data]);
}

export function logWarning(scope: string, ...data: unknown[]) {
    console.warn(...[`(${scope}) warn:`, ...data]);
}

export function logError(scope: string, ...data: unknown[]) {
    console.error(...[`(${scope}) error:`, ...data]);
}
