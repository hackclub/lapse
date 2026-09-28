/**
 * Pure checks for the Lookout desktop pairing protocol
 * (hackclub/lookout docs/integration.md, "Desktop instant start").
 *
 * The desktop app opens `GET {pairUrl}` in the browser, then exchanges a
 * code and starts sessions with no cookies. Validation lives here so the
 * route handlers and the tests share one definition of "a real request".
 */

const CHALLENGE_RE = /^[A-Za-z0-9_-]{43,128}$/;
const STATE_RE = /^[A-Za-z0-9_-]{16,512}$/;
const CODE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const VERIFIER_RE = /^[A-Za-z0-9_-]{32,256}$/;

/** Five minutes, the maximum the protocol allows a pairing code to live. */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

/** How many session mints one device may ask for per minute. */
export const START_LIMIT_PER_MINUTE = 10;

export interface PairingQuery {
    challenge: string;
    state: string;
    device: string;
}

export function readPairingQuery(query: Record<string, unknown>): PairingQuery | null {
    const challenge = typeof query.challenge === "string" ? query.challenge : "";
    const state = typeof query.state === "string" ? query.state : "";
    const device = typeof query.device === "string" ? query.device.trim() : "";
    if (!CHALLENGE_RE.test(challenge) || !STATE_RE.test(state) || !isDeviceLabel(device))
        return null;
    return { challenge, state, device };
}

export function isDeviceLabel(device: string): boolean {
    return device.length > 0
        && device.length <= 120
        && !/[\u0000-\u001f\u007f]/.test(device);
}

export function isExchangeBody(body: unknown): body is { code: string; verifier: string } {
    if (!body || typeof body !== "object")
        return false;
    const code = (body as { code?: unknown }).code;
    const verifier = (body as { verifier?: unknown }).verifier;
    return typeof code === "string" && CODE_RE.test(code)
        && typeof verifier === "string" && VERIFIER_RE.test(verifier);
}

/**
 * Consent page on the website. The API host cannot see the user's login:
 * Lapse keeps the access token in the site's localStorage, not in a cookie
 * the API domain would receive. The desktop app still opens the API pair
 * URL (that is what the Lookout registry stores), and this redirects it.
 *
 * The target path is fixed. Nothing in the query is allowed to choose a
 * host or a path, so this cannot be turned into an open redirect.
 */
export function consentPageUrl(webBase: string, query: PairingQuery): string {
    const url = new URL("/lookout/pair", webBase);
    url.searchParams.set("challenge", query.challenge);
    url.searchParams.set("state", query.state);
    url.searchParams.set("device", query.device);
    return url.toString();
}

/** True when this start is within the per-device budget. Mutates `recent`. */
export function allowStart(recent: number[], now: number): boolean {
    const fresh = recent.filter(t => now - t < 60_000);
    recent.length = 0;
    recent.push(...fresh);
    if (recent.length >= START_LIMIT_PER_MINUTE)
        return false;
    recent.push(now);
    return true;
}
