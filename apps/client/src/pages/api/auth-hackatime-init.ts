import type { NextApiRequest, NextApiResponse } from "next";
import { randomBytes, createHash } from "crypto";

import { env } from "@/server/env";
import { logNextRequest } from "@/server/serverCommon";

// POST /api/auth-hackatime-init
//    Initializes an OAuth flow by generating state and PKCE values.
//    Returns the authorize URL and sets a secure cookie with the state and code_verifier.

function generateCodeVerifier(): string {
    return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
    return randomBytes(16).toString("base64url");
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    logNextRequest("auth-hackatime-init", req);

    if (req.method !== "POST")
        return res.status(405).json({ error: "Method not allowed" });

    const clientId = env.HACKATIME_CLIENT_ID;
    const hackatimeUrl = env.HACKATIME_URL;
    const redirectUri = env.HACKATIME_REDIRECT_URI;

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const oauthData = JSON.stringify({ state, codeVerifier });
    const isProduction = process.env.NODE_ENV === "production";
    const secure = isProduction ? " Secure;" : "";

    res.setHeader("Set-Cookie", [
        `hackatime-oauth=${encodeURIComponent(oauthData)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600;${secure}`,
    ]);

    const authorizeUrl = new URL(`${hackatimeUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "profile");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    return res.status(200).json({ authorizeUrl: authorizeUrl.toString() });
}
