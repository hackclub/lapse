export type LogLevel = "log" | "warn" | "error";

export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp: Date;
}

type LogListener = () => void;

const logs: LogEntry[] = [];
const listeners: Set<LogListener> = new Set();

let initialized = false;

function formatArg(arg: unknown): string {
    if (arg === null)
        return "null";

    if (arg === undefined)
        return "undefined";

    if (typeof arg === "string")
        return arg;

    if (typeof arg === "number" || typeof arg === "boolean")
        return String(arg);

    if (arg instanceof Error)
        return `${arg.name}: ${arg.message}`;

    try {
        return JSON.stringify(arg);
    }
    catch {
        return String(arg);
    }
}

function formatArgs(args: unknown[]): string {
    return args.map(formatArg).join(" ");
}

function addLog(level: LogLevel, args: unknown[]) {
    logs.push({
        level,
        message: formatArgs(args),
        timestamp: new Date()
    });

    for (const listener of listeners) {
        listener();
    }
}

export function initLogBucket() {
    if (initialized)
        return;

    initialized = true;

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: unknown[]) => {
        addLog("log", args);
        originalLog.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
        addLog("warn", args);
        originalWarn.apply(console, args);
    };

    console.error = (...args: unknown[]) => {
        addLog("error", args);
        originalError.apply(console, args);
    };
}

export function getLogs(): LogEntry[] {
    return [...logs];
}

export function subscribeToLogs(listener: LogListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
