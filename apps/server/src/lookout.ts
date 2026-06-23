import { env } from "@/env.js";
import { logError, logInfo } from "@/logging.js";

interface LookoutSessionCreated {
    token: string;
    sessionId: string;
    sessionUrl: string;
}

interface LookoutSessionDetails {
    session: {
        id: string;
        name: string;
        status: string;
        metadata: Record<string, unknown>;
        trackedSeconds: number;
        videoUrl: string | null;
        thumbnailUrl: string | null;
    };
    trackedSeconds: number;
    screenshotCount: number;
    clientInfo: string | null;
}

interface LookoutTimings {
    status: string;
    count: number;
    first: string | null;
    last: string | null;
    clientInfo: string | null;
    timestamps: string[];
}

async function lookoutFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${env.LOOKOUT_API_BASE_URL}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "X-API-Key": env.LOOKOUT_API_KEY,
            ...options?.headers,
        },
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "(no body)");
        const msg = `Lookout API error: ${res.status} ${res.statusText} on ${path} — ${body}`;
        logError(msg);
        throw new Error(msg);
    }

    return res.json() as Promise<T>;
}

export async function createSession(
    name?: string,
    metadata?: Record<string, unknown>
): Promise<LookoutSessionCreated> {
    const result = await lookoutFetch<LookoutSessionCreated>("/api/internal/sessions", {
        method: "POST",
        body: JSON.stringify({ name, metadata }),
    });

    logInfo(`Created Lookout session ${result.sessionId}`);
    return result;
}

export async function getSession(sessionId: string): Promise<LookoutSessionDetails> {
    return lookoutFetch<LookoutSessionDetails>(`/api/internal/sessions/${sessionId}`);
}

export async function getTimings(token: string): Promise<LookoutTimings> {
    const url = `${env.LOOKOUT_API_BASE_URL}/api/sessions/${token}/timings`;
    const res = await fetch(url);

    if (!res.ok) {
        const body = await res.text().catch(() => "(no body)");
        const msg = `Lookout timings error: ${res.status} on /api/sessions/:token/timings — ${body}`;
        logError(msg);
        throw new Error(msg);
    }

    return res.json() as Promise<LookoutTimings>;
}
