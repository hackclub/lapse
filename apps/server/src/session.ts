import type { FastifyRequest } from "fastify";
import { deleteCookie, getCookie, setCookie } from "@orpc/server/helpers";

import { env } from "@/env.js";

/**
 * The Lapse website's session.
 *
 * The website used to keep its access token in `localStorage`, where any script running on the page could read it -
 * so one XSS was a full account takeover, good for thirty days and usable from anywhere. The token now lives in a
 * cookie that scripts can't read. Third-party apps, the Lookout desktop app and program keys still send
 * `Authorization: Bearer`, exactly as before.
 *
 * A cookie is sent by the browser whether or not our own page asked for the request, so it is only honoured when
 * the request's `Origin` says the website made it (see `isFromWebsite`). That is the whole of our CSRF protection,
 * and it is why the API's CORS policy can stay open for third-party apps: no other origin can use the cookie.
 *
 * The `__Host-` prefix makes browsers refuse the cookie unless it was set by this exact host, over HTTPS. Without
 * it, any other `hackclub.com` subdomain could plant a session cookie of its own choosing for the API - and have
 * somebody record into an account that isn't theirs. Browsers only honour the prefix over HTTPS, so development
 * goes without.
 */
const IS_PRODUCTION = process.env["NODE_ENV"] === "production";
export const SESSION_COOKIE_NAME = IS_PRODUCTION ? "__Host-lapse_session" : "lapse_session";

/**
 * How recently somebody must have signed in to use administrator powers. See `policy.ts`.
 */
export const ADMIN_REAUTH_WINDOW_MS = 60 * 60 * 1000;

const COOKIE_OPTIONS = {
    // No `domain`, so the cookie belongs to the API's host alone. `__Host-` requires that, and this path.
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION
} as const;

function originOf(url: string): string | null {
    try {
        return new URL(url).origin;
    }
    catch {
        return null;
    }
}

/**
 * Returns `true` if the request was made by a page of the Lapse website.
 *
 * Browsers attach `Origin` to every cross-origin request a page makes, and a page can't change it - so a request
 * from another site (or another `hackclub.com` subdomain, which `SameSite` does nothing about) can't pass for ours.
 * Requests without an `Origin` aren't the website's either: it is always a different origin from the API. The one
 * exception is a deployment that serves both from a single origin, where the browser vouches for same-origin
 * requests with `Sec-Fetch-Site` instead.
 */
export function isFromWebsite(req: FastifyRequest): boolean {
    const website = originOf(env.WEB_BASE_URL);
    if (!website)
        return false;

    const origin = req.headers.origin;
    if (origin !== undefined)
        return origin === website;

    return originOf(env.BASE_URL) === website && req.headers["sec-fetch-site"] === "same-origin";
}

/**
 * The session cookie of a request made by the website, if it has one.
 */
export function sessionCookieOf(req: FastifyRequest): string | null {
    if (!isFromWebsite(req))
        return null;

    const cookie = req.headers.cookie;
    if (!cookie)
        return null;

    return getCookie(new Headers({ cookie }), SESSION_COOKIE_NAME) ?? null;
}

export function setSessionCookie(resHeaders: Headers | undefined, token: string, expiresAt: Date) {
    if (!resHeaders)
        throw new Error("Couldn't access response headers to start a session.");

    setCookie(resHeaders, SESSION_COOKIE_NAME, token, {
        ...COOKIE_OPTIONS,
        maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
    });
}

export function clearSessionCookie(resHeaders: Headers | undefined) {
    if (resHeaders)
        deleteCookie(resHeaders, SESSION_COOKIE_NAME, COOKIE_OPTIONS);
}
