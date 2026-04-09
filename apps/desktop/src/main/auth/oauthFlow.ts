import * as crypto from "node:crypto";
import { app, shell } from "electron";
import { saveToken, loadToken, clearToken } from "./tokenStore";

const API_URL = process.env.LAPSE_API_URL ?? "https://api.lapse.hackclub.com";
const CLIENT_ID = process.env.LAPSE_OAUTH_CLIENT_ID ?? "lapse-desktop";
const REDIRECT_URI = "lapse://auth/callback";

/**
 * Generates a cryptographically random string of the given byte length,
 * returned as a hex-encoded string.
 */
function randomString(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/**
 * Derives a PKCE `code_challenge` from the given `code_verifier` using
 * SHA-256 + base64url encoding (S256 method).
 */
function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface PendingAuth {
  state: string;
  codeVerifier: string;
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

class OAuthService {
  private token: string | null = null;
  private pending: PendingAuth | null = null;
  private initialized = false;

  /**
   * Loads a previously persisted token from disk. Must be called once during
   * app startup (after `app.whenReady()`).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.token = await loadToken();
    this.initialized = true;
  }

  /**
   * Opens the system browser to begin the OAuth2 PKCE authorization flow.
   * Resolves with the access token once the callback is received and the
   * authorization code has been exchanged.
   */
  login(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const state = randomString(16);
      const codeVerifier = randomString(32);
      const codeChallenge = generateCodeChallenge(codeVerifier);

      this.pending = { state, codeVerifier, resolve, reject };

      const url = new URL(`${API_URL}/api/auth/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", CLIENT_ID);
      url.searchParams.set("redirect_uri", REDIRECT_URI);
      url.searchParams.set("scope", "elevated");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");

      shell.openExternal(url.href).catch(err => {
        this.pending = null;
        reject(err);
      });
    });
  }

  /**
   * Handles an incoming `lapse://` callback URL. This is called from the
   * main process when either the `open-url` event fires (macOS) or from
   * `second-instance` argv parsing (Windows/Linux).
   */
  async handleCallback(callbackUrl: string): Promise<void> {
    if (!this.pending) {
      console.warn("(oauthFlow.ts) received callback but no auth flow is pending");
      return;
    }

    const { state, codeVerifier, resolve, reject } = this.pending;
    this.pending = null;

    let parsed: URL;
    try {
      parsed = new URL(callbackUrl);
    } catch {
      reject(new Error("Invalid callback URL"));
      return;
    }

    const error = parsed.searchParams.get("error");
    if (error) {
      reject(new Error(`OAuth error: ${error}`));
      return;
    }

    const code = parsed.searchParams.get("code");
    const returnedState = parsed.searchParams.get("state");

    if (!code) {
      reject(new Error("No authorization code in callback"));
      return;
    }

    if (returnedState !== state) {
      reject(new Error("State mismatch -- possible CSRF"));
      return;
    }

    try {
      const token = await this.exchangeCode(code, codeVerifier);
      this.token = token;
      await saveToken(token);
      resolve(token);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Exchanges an authorization code for an access token via the token
   * endpoint.
   */
  private async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    const response = await fetch(`${API_URL}/api/auth/token`, {
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
        code_verifier: codeVerifier
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  /**
   * Returns the current access token, or `null` if not authenticated.
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Returns `true` if the user currently has a stored access token.
   */
  isAuthenticated(): boolean {
    return this.token !== null;
  }

  /**
   * Manually set a token (for dev/testing — paste a token from the web client).
   */
  async setToken(token: string): Promise<void> {
    this.token = token;
    await saveToken(token);
  }

  /**
   * Clears the current token from memory and disk.
   */
  async logout(): Promise<void> {
    this.token = null;
    await clearToken();
  }
}

/**
 * Singleton OAuth service for the desktop app.
 */
export const authService = new OAuthService();
