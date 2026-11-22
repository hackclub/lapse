import { toast } from "sonner";

/**
 * Where this browser's session is kept.
 *
 * It used to be an access token in `localStorage`, where any script on the page could read it. It is now a cookie
 * only the API can see. `localStorage` keeps an empty entry under the old name while somebody is signed in: tabs
 * watch it to notice a sign-out elsewhere (see `AuthContext`), including tabs still running a build from before
 * this, which sign themselves out if the entry disappears - so it is emptied rather than removed when a session
 * moves into the cookie, or a tab left recording through a deploy would be thrown out of it.
 *
 * A token is only still stored where a cookie can't work: a build of the website served from somewhere the API
 * doesn't know as the website (a preview deployment, say), which carries on exactly as before.
 */
export const SESSION_KEY = "lapse:token";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com";
const MOVE_TIMEOUT_MS = 8000;

/**
 * The access token to send with requests, or `null` if the session is in the cookie (or there isn't one).
 */
export function storedToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY) || null;
  }
  catch {
    // Storage is off limits in some embedded contexts - the Lookout desktop app's panel, for one.
    return null;
  }
}

/**
 * Remembers that somebody is signed in. `token` is empty when the session is in the cookie.
 */
export function rememberSignIn(token: string) {
  localStorage.removeItem(SIGN_OUT_PENDING_KEY);
  localStorage.setItem(SESSION_KEY, token);
}

/**
 * Makes sure other tabs can be told when this session ends: they watch for `SESSION_KEY` being removed, which only
 * shows if it was there to begin with.
 */
export function markSignedIn() {
  try {
    if (localStorage.getItem(SESSION_KEY) === null)
      localStorage.setItem(SESSION_KEY, "");
  }
  catch {
    // Without storage there are no other tabs to tell.
  }
}

const SIGN_OUT_PENDING_KEY = "lapse:signOutPending";

/**
 * Signs out without the API's help, for when it can't be reached. Scripts can't delete the session cookie, so until
 * the API has been told, this browser simply stops sending it.
 */
export function signOutLater() {
  localStorage.setItem(SIGN_OUT_PENDING_KEY, "1");
}

function isSignOutPending() {
  try {
    return localStorage.getItem(SIGN_OUT_PENDING_KEY) === "1";
  }
  catch {
    return false;
  }
}

/**
 * Whether requests to the API should carry the session cookie.
 */
export function sessionCredentials(): RequestCredentials {
  return isSignOutPending() ? "omit" : "include";
}

async function finishSignOut() {
  if (!isSignOutPending())
    return;

  try {
    const res = await fetch(`${API_URL}/api/user/signOut`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(MOVE_TIMEOUT_MS),
    });

    if (res.ok)
      localStorage.removeItem(SIGN_OUT_PENDING_KEY);
  }
  catch (err) {
    console.warn("(session.ts) still couldn't reach the API to finish signing out.", err);
  }
}

async function ask(token: string, confirm: boolean): Promise<"cookie" | "bearer" | null> {
  const res = await fetch(`${API_URL}/api/auth/session`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, confirm }),
    signal: AbortSignal.timeout(MOVE_TIMEOUT_MS),
  });

  if (!res.ok)
    return null;

  const result: unknown = await res.json();
  if (typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true || !("data" in result))
    return null;

  const mode = (result.data as { mode?: unknown }).mode;
  return mode === "cookie" || mode === "bearer" ? mode : null;
}

/**
 * Moves a token left in `localStorage` by an earlier build into the session cookie. Whatever goes wrong, the token
 * is kept and keeps working, so the worst case is that this is tried again on the next page load.
 */
async function moveSessionIntoCookie() {
  const token = storedToken();
  if (!token)
    return;

  try {
    // Not the website as far as the API is concerned, so there is no cookie to be had. No need to ask on every page.
    if (sessionStorage.getItem(KEEPS_TOKEN_KEY) === token)
      return;

    // The second call only succeeds if the browser sent back the cookie the first one set - and only then does
    // the API revoke the token, and only then is it safe to forget. Several tabs doing this at once is fine: the
    // API prefers the cookie over a token from the moment the cookie exists.
    const offered = await ask(token, false);
    if (offered === "bearer")
      sessionStorage.setItem(KEEPS_TOKEN_KEY, token);

    if (offered !== "cookie" || await ask(token, true) !== "cookie")
      return;

    if (storedToken() === token)
      localStorage.setItem(SESSION_KEY, "");
  }
  catch (err) {
    console.warn("(session.ts) couldn't move the session into a cookie; will try again later.", err);
  }
}

const KEEPS_TOKEN_KEY = "lapse:session.keepsToken";

let ready: Promise<void> | null = null;

/**
 * Resolves once this browser's session is where it should be. Every API request waits for it, so none is sent with
 * a token that is being revoked at that very moment. It never rejects: failing here must not fail every request.
 */
export function whenSessionReady(): Promise<void> {
  if (typeof window === "undefined")
    return Promise.resolve();

  ready ??= (async () => {
    await finishSignOut();
    await moveSessionIntoCookie();
  })().catch(err => console.warn("(session.ts) couldn't settle the session.", err));

  return ready;
}

const REAUTH_TOAST_ID = "lapse:reauthenticate";

/**
 * Set in `sessionStorage` while an administrator is being sent through sign-in again, so the sign-in page knows to
 * finish it even though they are still signed in.
 */
export const REAUTH_KEY = "lapse:oauth_reauth";

/**
 * Asks an administrator to sign in again. The API only honours administrator powers for a while after signing in,
 * so this is what an admin sees in place of an error - nobody else can get here.
 */
export function askToSignInAgain() {
  if (typeof window === "undefined")
    return;

  const path = window.location.pathname;
  if (path === "/auth" || path.startsWith("/oauth/"))
    return;

  toast("Confirm it's you to keep using admin tools", {
    id: REAUTH_TOAST_ID,
    action: {
      label: "Sign in",
      onClick: () => {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        sessionStorage.setItem(REAUTH_KEY, "1");
        window.location.href = `/auth?force=1&redirect=${redirect}`;
      },
    },
    duration: Infinity,
    closeButton: true,
  });
}
