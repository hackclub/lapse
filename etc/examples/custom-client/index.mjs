// @ts-check
/**
 * A minimal OAuth2 test client for Lapse.
 *
 * This client serves a web page with a link to begin the OAuth2 Authorization
 * Code + PKCE flow. After authentication, the callback page displays the
 * authenticated user's profile data.
 *
 * Usage:
 *   node index.mjs --api-url <API_URL> --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET> [--port <PORT>] [--scopes <SCOPES>]
 *
 * The redirect URI is automatically set to http://localhost:<PORT>/callback,
 * so make sure to register that URI on the service client.
 */

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/** @param {string} flag */
function getArg(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1)
        return null;

    return process.argv[index + 1] ?? null;
}

/** @param {string} flag */
function requiredArg(flag) {
    const value = getArg(flag);
    if (!value)
        throw new Error(`Missing required argument: ${flag}`);

    return value;
}

const API_URL = requiredArg("--api-url").replace(/\/$/, "");
const CLIENT_ID = requiredArg("--client-id");
const CLIENT_SECRET = requiredArg("--client-secret");
const PORT = Number(getArg("--port") ?? "9736");
const SCOPES = getArg("--scopes") ?? "user:read";
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/** @param {number} length */
function generateRandomString(length) {
    return randomBytes(length).toString("hex");
}

/** @param {string} verifier */
function generateCodeChallenge(verifier) {
    return createHash("sha256")
        .update(verifier)
        .digest("base64url");
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

/** @param {string} str */
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** @param {string} authorizeUrl */
function homePage(authorizeUrl) {
    return /*html*/`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <title>Lapse OAuth2 Test Client</title>
            <style>
                body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #e4e4e4; background: #1a1a1a; }
                h1 { font-size: 1.4rem; }
                a.btn { display: inline-block; margin-top: 16px; padding: 10px 24px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; }
                a.btn:hover { background: #2563eb; }
                code { background: #2a2a2a; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
                .info { margin-top: 24px; color: #888; font-size: 0.85rem; }
            </style>
        </head>
        <body>
            <h1>Lapse OAuth2 Test Client</h1>
            <p>Click the button below to authenticate with Lapse via OAuth2.</p>
            <p>Requesting scopes: <code>${escapeHtml(SCOPES)}</code></p>
            <a class="btn" href="${escapeHtml(authorizeUrl)}">Sign in with Lapse</a>
            <p class="info">API: <code>${escapeHtml(API_URL)}</code> · Client ID: <code>${escapeHtml(CLIENT_ID)}</code></p>
        </body>
        </html>
    `;
}

/**
 * @param {string} title
 * @param {string} detail
 */
function errorPage(title, detail) {
    return /*html*/`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <title>Error – Lapse Test Client</title>
            <style>
                body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #e4e4e4; background: #1a1a1a; }
                h1 { font-size: 1.4rem; color: #ef4444; }
                pre { background: #2a2a2a; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; }
                a { color: #3b82f6; }
            </style>
        </head>
        <body>
            <h1>${escapeHtml(title)}</h1>
            <pre>${escapeHtml(detail)}</pre>
            <p><a href="/">← Try again</a></p>
        </body>
        </html>
    `;
}

/**
 * @param {Record<string, unknown>} tokenData
 * @param {Record<string, unknown>} userData
 */
function profilePage(tokenData, userData) {
    const tokenJson = JSON.stringify(tokenData, null, 2);
    const userJson = JSON.stringify(userData, null, 2);

    return /*html*/`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <title>Authenticated – Lapse Test Client</title>
            <style>
                body { font-family: system-ui, sans-serif; max-width: 700px; margin: 80px auto; padding: 0 20px; color: #e4e4e4; background: #1a1a1a; }
                h1 { font-size: 1.4rem; color: #22c55e; }
                h2 { font-size: 1.1rem; margin-top: 28px; }
                pre { background: #2a2a2a; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; white-space: pre-wrap; word-break: break-all; }
                a { color: #3b82f6; }
            </style>
        </head>
        <body>
            <h1>✓ Authentication successful</h1>

            <h2>Token response</h2>
            <pre>${escapeHtml(tokenJson)}</pre>

            <h2>User profile <code>GET /api/user/myself</code></h2>
            <pre>${escapeHtml(userJson)}</pre>

            <p><a href="/">← Start over</a></p>
        </body>
        </html>
    `;
}

// ---------------------------------------------------------------------------
// OAuth state (regenerated per attempt via the home page link)
// ---------------------------------------------------------------------------

let state = generateRandomString(16);
let codeVerifier = generateRandomString(32);
let codeChallenge = generateCodeChallenge(codeVerifier);

/** @returns {string} */
function buildAuthorizeUrl() {
    const url = new URL(`${API_URL}/api/auth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.href;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
    if (!req.url) {
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === "/") {
        // Regenerate PKCE + state for each new attempt.
        state = generateRandomString(16);
        codeVerifier = generateRandomString(32);
        codeChallenge = generateCodeChallenge(codeVerifier);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(homePage(buildAuthorizeUrl()));
        return;
    }

    if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
    }

    // --- OAuth2 callback ---

    const error = url.searchParams.get("error");
    if (error) {
        console.error(`✗ Authorization failed: ${error}`);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(errorPage("Authorization failed", error));
        return;
    }

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");

    if (!code || !returnedState) {
        console.error("✗ Missing code or state in callback");
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(errorPage("Bad callback", "Missing code or state parameter."));
        return;
    }

    if (returnedState !== state) {
        console.error("✗ State mismatch – possible CSRF attack");
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(errorPage("State mismatch", "The state parameter does not match. This could indicate a CSRF attack."));
        return;
    }

    console.log("✓ Received authorization code, exchanging for token...");

    try {
        const tokenRes = await fetch(`${API_URL}/api/auth/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json"
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: REDIRECT_URI,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code_verifier: codeVerifier
            })
        });

        if (!tokenRes.ok) {
            const body = await tokenRes.text();
            console.error(`✗ Token exchange failed (HTTP ${tokenRes.status}): ${body}`);
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(errorPage(`Token exchange failed (HTTP ${tokenRes.status})`, body));
            return;
        }

        const tokenData = await tokenRes.json();
        console.log("✓ Token exchange successful!");

        const userRes = await fetch(`${API_URL}/api/user/myself`, {
            headers: {
                "Authorization": `Bearer ${tokenData.access_token}`,
                "Accept": "application/json"
            }
        });

        let userData;
        if (!userRes.ok) {
            const body = await userRes.text();
            console.error(`✗ Failed to fetch user profile (HTTP ${userRes.status}): ${body}`);
            userData = { error: `Failed to fetch profile (HTTP ${userRes.status})`, detail: body };
        }
        else {
            userData = await userRes.json();
            console.log("✓ User profile fetched successfully");
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(profilePage(tokenData, userData));
    }
    catch (err) {
        console.error("✗ Error during token exchange:", err);
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(errorPage("Internal error", String(err)));
    }
});

server.listen(PORT, () => {
    console.log(`running @ http://localhost:${PORT}`);
});
