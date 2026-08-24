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
        trackingMode: string;
        totalActiveSeconds: number;
    };
    trackedSeconds: number;
    screenshotCount: number;
    clientInfo: string | null;
}

export interface LookoutTimings {
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
    metadata?: Record<string, unknown>,
    options?: { clips?: boolean; redirectUrl?: string; panelUrl?: string }
): Promise<LookoutSessionCreated> {
    const result = await lookoutFetch<LookoutSessionCreated>("/api/internal/sessions", {
        method: "POST",
        // `clips` (not `clip`/`clipsEnabled`) is the field that flips `clipsEnabled` on
        // the session, unlocking the cut/edit flow.
        //
        // `redirectUrl` is Lookout's redirect hook: the recording client sends the user there once the
        // timelapse finishes compiling (the desktop app opens it in their default browser). It's immutable
        // after creation, and Lookout only accepts http(s).
        //
        // `panelUrl` is our publish flow rendered *inside* the desktop app, in place of that redirect.
        // Also immutable, https only, and it must be unguessable: a third-party iframe receives none of
        // our cookies, so the URL is the only credential the panel has. Lookout opens it as soon as the
        // recording is saved, so it loads while the session is still compiling.
        body: JSON.stringify({
            name,
            metadata,
            clips: options?.clips,
            redirectUrl: options?.redirectUrl,
            panelUrl: options?.panelUrl,
        }),
    });

    logInfo(`Created Lookout session ${result.sessionId}`);
    return result;
}

/**
 * Tells Lookout we have what the panel was asking for, so it stops offering it.
 *
 * Needed because the user can answer the panel in the desktop app's sheet *or* here on the website,
 * and Lookout can see inside neither. Without this the desktop app keeps showing a "Lapse needs a few
 * details" card for a timelapse that is already published. Idempotent on Lookout's side, and a no-op
 * for sessions with no panel, so it is safe to call unconditionally whenever we publish.
 */
export async function markPanelResolved(sessionId: string): Promise<void> {
    await lookoutFetch<{ panelResolved: boolean }>(`/api/internal/sessions/${sessionId}/panel-resolved`, {
        method: "POST",
    });
}

/**
 * Points the desktop app's "Open in Lapse" action at a published timelapse.
 *
 * Mutable on Lookout, unlike the other two URLs, which is the whole point: the page being linked to
 * does not exist until the user publishes.
 */
export async function setViewUrl(sessionId: string, viewUrl: string | null): Promise<void> {
    await lookoutFetch<{ viewUrl: string | null }>(`/api/internal/sessions/${sessionId}/view-url`, {
        method: "POST",
        body: JSON.stringify({ viewUrl }),
    });
}

export async function getSession(sessionId: string): Promise<LookoutSessionDetails> {
    return lookoutFetch<LookoutSessionDetails>(`/api/internal/sessions/${sessionId}`);
}

/**
 * Whether a session was recorded through the Lookout desktop app, rather than in a browser through our own recorder.
 *
 * `clientInfo` is Lookout's User-Agent-like telemetry string, recorded on the session's *first* upload - so it's
 * `null` for a session that never uploaded anything. The format is a convention rather than something Lookout
 * enforces (see `formatClientInfo` in `@lookout/shared`), which is why this is a lenient prefix match: anything we
 * can't confidently read as the desktop app counts as not-desktop, leaving Lapse's own behaviour as the default.
 */
export function isDesktopClient(clientInfo: string | null): boolean {
    return /^Lookout Desktop\b/i.test(clientInfo ?? "");
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
