import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { generateJWT } from "@/server/auth";
import { env } from "@/server/env";
import { logError, logNextRequest } from "@/server/serverCommon";
import { database } from "@/server/db";

// GET /api/auth-hackatime
//    Meant to be used as a callback URL - the user will be redirected to this API endpoint when
//    authenticating with Hackatime.
//
//    Parameters:
//      - code: the OAuth code, given by Hackatime
//      - state: the CSRF state token, must match the one stored in the cookie
//      - error: redirects user to /?error=oauth-<error> when present

const HackatimeTokenResponseSchema = z.object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number(),
    refresh_token: z.string().optional(),
});

const HackatimeMeResponseSchema = z.object({
    id: z.number(),
    emails: z.array(z.string().email()),
    slack_id: z.string().nullable().optional(),
    github_username: z.string().nullable().optional(),
});

const OAuthCookieSchema = z.object({
    state: z.string(),
    codeVerifier: z.string(),
});

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
    if (!cookieHeader) return {};
    return Object.fromEntries(
        cookieHeader.split(";").map(c => {
            const [key, ...rest] = c.trim().split("=");
            return [key, rest.join("=")];
        })
    );
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    logNextRequest("auth-hackatime", req);

    if (req.method !== "GET")
        return res.status(405).redirect("/?error=invalid-method");

    const { code, error, state } = req.query;

    if (error)
        return res.redirect(`/?error=oauth-${error}`);

    if (!code || typeof code !== "string")
        return res.redirect("/?error=missing-code");

    if (!state || typeof state !== "string")
        return res.redirect("/?error=missing-state");

    const cookies = parseCookies(req.headers.cookie);
    const oauthCookieRaw = cookies["hackatime-oauth"];

    if (!oauthCookieRaw) {
        logError("auth-hackatime", "Missing OAuth cookie");
        return res.redirect("/?error=oauth-state-mismatch");
    }

    let oauthData: z.infer<typeof OAuthCookieSchema>;
    try {
        const parsed = JSON.parse(decodeURIComponent(oauthCookieRaw));
        const result = OAuthCookieSchema.safeParse(parsed);
        if (!result.success) {
            logError("auth-hackatime", "Invalid OAuth cookie format", { error: result.error });
            return res.redirect("/?error=oauth-state-mismatch");
        }
        oauthData = result.data;
    }
    catch (error) {
        logError("auth-hackatime", "Failed to parse OAuth cookie", { error });
        return res.redirect("/?error=oauth-state-mismatch");
    }

    if (state !== oauthData.state) {
        logError("auth-hackatime", "State mismatch", { expected: oauthData.state, received: state });
        return res.redirect("/?error=oauth-state-mismatch");
    }

    const clientId = env.HACKATIME_CLIENT_ID;
    const hackatimeUrl = env.HACKATIME_URL;
    const redirectUri = env.HACKATIME_REDIRECT_URI;

    try {
        const tokenRequestBody: Record<string, string> = {
            client_id: clientId,
            code: code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
            code_verifier: oauthData.codeVerifier,
        };

        const tokenResponse = await fetch(`${hackatimeUrl}/oauth/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(tokenRequestBody),
        });

        if (!tokenResponse.ok) {
            const errorBody = await tokenResponse.text();
            logError("auth-hackatime", "Token exchange failed", { status: tokenResponse.status, body: errorBody });
            return res.redirect("/?error=token-exchange-failed");
        }

        const tokenDataRaw = await tokenResponse.json();

        const tokenDataResult = HackatimeTokenResponseSchema.safeParse(tokenDataRaw);

        if (!tokenDataResult.success) {
            logError("auth-hackatime", "Invalid token response format.", { error: tokenDataResult.error, tokenDataRaw });
            return res.redirect("/?error=invalid-token-response");
        }

        const tokenData = tokenDataResult.data;

        const userResponse = await fetch(`${hackatimeUrl}/api/v1/authenticated/me`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
            },
        });

        const userDataRaw = await userResponse.json();

        const userDataResult = HackatimeMeResponseSchema.safeParse(userDataRaw);

        if (!userDataResult.success) {
            logError("auth-hackatime", "Invalid user response format.", { error: userDataResult.error, userDataRaw });
            return res.redirect("/?error=invalid-user-response");
        }

        const hackatimeUser = userDataResult.data;
        const primaryEmail = hackatimeUser.emails[0];

        if (!primaryEmail) {
            logError("auth-hackatime", "No email found in Hackatime profile.", { hackatimeUser });
            return res.redirect("/?error=no-email");
        }

        let profilePictureUrl: string | null = null;
        if (hackatimeUser.slack_id) {
            try {
                const slackUserResponse = await fetch(`${env.SLACK_API_URL}/users.info`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${env.SLACK_BOT_TOKEN}`,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: `user=${hackatimeUser.slack_id}`,
                });

                const slackUserData = await slackUserResponse.json();
                if (slackUserData.ok && slackUserData.user) {
                    profilePictureUrl = slackUserData.user.profile?.image_512 
                        || slackUserData.user.profile?.image_192
                        || null;
                }
            }
            catch (error) {
                logError("auth-hackatime", "Failed to fetch Slack profile picture", { error, slack_id: hackatimeUser.slack_id });
            }
        }

        if (!profilePictureUrl) {
            logError("auth-hackatime", "Could not obtain profile picture for user", { hackatimeUser });
            return res.redirect("/?error=no-profile-picture");
        }

        const hackatimeId = hackatimeUser.id.toString();
        const allEmails = hackatimeUser.emails;

        let dbUser = await database.user.findFirst({
            where: { hackatimeId },
        });

        if (!dbUser && hackatimeUser.slack_id) {
            dbUser = await database.user.findFirst({
                where: { slackId: hackatimeUser.slack_id },
            });
        }

        if (!dbUser) {
            dbUser = await database.user.findFirst({
                where: { email: { in: allEmails } },
            });
        }

        if (!dbUser) {
            const baseHandle = primaryEmail.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
            let handle = baseHandle;
            let counter = 1;

            while (await database.user.findFirst({ where: { handle } })) {
                handle = `${baseHandle}${counter}`;
                counter++;
            }

            dbUser = await database.user.create({
                data: {
                    email: primaryEmail,
                    hackatimeId: hackatimeUser.id.toString(),
                    hackatimeAccessToken: tokenData.access_token,
                    hackatimeRefreshToken: tokenData.refresh_token || null,
                    slackId: hackatimeUser.slack_id || null,
                    handle: handle,
                    displayName: primaryEmail.split("@")[0],
                    profilePictureUrl: profilePictureUrl,
                    bio: "",
                    urls: [],
                    permissionLevel: "USER",
                    createdAt: new Date()
                },
            });
        }
        else {
            const updateData: Parameters<typeof database.user.update>[0]["data"] = {
                hackatimeId,
                hackatimeAccessToken: tokenData.access_token,
                hackatimeRefreshToken: tokenData.refresh_token || null,
            };

            if (hackatimeUser.slack_id) {
                if (!dbUser.slackId || dbUser.slackId === hackatimeUser.slack_id) {
                    updateData.slackId = hackatimeUser.slack_id;
                }
                else {
                    logError("auth-hackatime", "Slack ID mismatch during Hackatime login", {
                        userId: dbUser.id,
                        existingSlackId: dbUser.slackId,
                        hackatimeSlackId: hackatimeUser.slack_id,
                    });
                }
            }

            updateData.profilePictureUrl = profilePictureUrl;
            dbUser = await database.user.update({
                where: { id: dbUser.id },
                data: updateData,
            });
        }

        const isProduction = process.env.NODE_ENV === "production";
        const secure = isProduction ? " Secure;" : "";

        const authToken = generateJWT(dbUser.id, dbUser.email);
        res.setHeader("Set-Cookie", [
            `lapse-auth=${authToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000;${secure}`,
            `hackatime-oauth=; Path=/; HttpOnly; Max-Age=0`,
        ]);

        return res.redirect("/?auth=success");
    }
    catch (error) {
        logError("auth-hackatime", "Hackatime OAuth error!", { error });
        return res.redirect("/?error=server-error");
    }
}
