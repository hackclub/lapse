import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

import { matchOrDefault } from "@hackclub/lapse-shared";
import type { OAuthErrorCode } from "@hackclub/lapse-api";

import RootLayout from "@/components/layout/RootLayout";
import { useAuthContext } from "@/context/AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com/api";
const OAUTH_CLIENT_ID = process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID!;

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, "0")).join("");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export default function Auth() {
  const router = useRouter();
  const { currentUser, isLoading } = useAuthContext();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const oauthInitiated = useRef(false);

  useEffect(() => {
    if (isLoading)
      return;

    if (currentUser && !currentUser.private.needsReauth) {
      router.push("/");
      return;
    }

    const { code, state, error } = router.query;

    if (error)
      return;

    if (typeof code === "string" && typeof state === "string") {
      exchangeToken(code, state);
      return;
    }

    if (oauthInitiated.current)
      return;

    oauthInitiated.current = true;
    initOAuth();
  }, [router, isLoading, currentUser]);

  async function initOAuth() {
    const state = generateRandomString(16);
    const codeVerifier = generateRandomString(32);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    sessionStorage.setItem("lapse:oauth_state", state);
    sessionStorage.setItem("lapse:oauth_code_verifier", codeVerifier);

    const redirectUri = `${window.location.origin}/auth`;

    const url = new URL(`${API_URL}/auth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", OAUTH_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "elevated");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    window.location.href = url.href;
  }

  async function exchangeToken(code: string, state: string) {
    const savedState = sessionStorage.getItem("lapse:oauth_state");
    const codeVerifier = sessionStorage.getItem("lapse:oauth_code_verifier");

    if (state !== savedState || !codeVerifier) {
      setStatus("error");
      router.replace("/auth?error=state_mismatch");
      return;
    }

    sessionStorage.removeItem("lapse:oauth_state");
    sessionStorage.removeItem("lapse:oauth_code_verifier");

    try {
      const response = await fetch(`${API_URL}/auth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${window.location.origin}/auth`,
          client_id: OAUTH_CLIENT_ID,
          code_verifier: codeVerifier,
        })
      });

      if (!response.ok) {
        console.error("(auth.tsx) token exchange failed!", await response.text());
        setStatus("error");
        router.replace("/auth?error=token_exchange_failed");
        return;
      }

      const data = await response.json();
      localStorage.setItem("lapse:token", data.access_token);
      router.push("/");
    }
    catch (err) {
      console.error("(auth.tsx) error during token exchange!", err);
      setStatus("error");
      router.replace("/auth?error=token_exchange_failed");
    }
  }

  const error = router.query.error;
  const errorMessage = error
    ? matchOrDefault(error as string, {
      "state_mismatch": "Security validation failed - please try again",
      "server_error": "A server error occurred",
      "upstream_token_exchange_failed": "Failed to exchange code for token with Hackatime",
      "upstream_identity_query_failed": "Failed to verify your identity with Hackatime",
      "upstream_data_missing": "Missing required data from Hackatime",
      "upstream_data_malformed": "Invalid response from Hackatime",
      "upstream_state_mismatch": "Security validation failed - please try again",
      "upstream_server_error": "Hackatime encountered a server error",
      "upstream_access_denied": "Access denied by Hackatime",
      "upstream_invalid_request": "Invalid request to Hackatime",
      "upstream_invalid_redirect_uri": "Invalid redirect URI",
      "upstream_unauthorized_client": "Unauthorized client",
      "upstream_invalid_scope": "Invalid scope requested",
      "upstream_invalid_code_challenge_method": "Invalid code challenge method",
      "upstream_temporarily_unavailable": "Hackatime is temporarily unavailable",
      "token_exchange_failed": "Failed to exchange authorization code for a token",
    } satisfies Record<OAuthErrorCode | "token_exchange_failed", string>) ?? (error as string)
    : null;

  return (
    <RootLayout showHeader={true}>
      <div className="flex w-full h-full items-center justify-center flex-col">
        <div className="text-center">
          {status === "loading" && !error && (
            <p className="text-smoke">Redirecting to Hackatime for authentication...</p>
          )}
          {errorMessage && <p className="text-red-500 mt-4">{errorMessage}</p>}
        </div>
      </div>
    </RootLayout>
  );
}
