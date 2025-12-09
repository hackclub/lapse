import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { PrismaClient } from "@/generated/prisma";

import { generateJWT } from "@/server/auth";
import { env } from "@/server/env";
import { logError, logNextRequest } from "@/server/serverCommon";

// GET /api/authSlack
//    Meant to be used as a callback URL - the user will be redirected to this API endpoint when
//    authenticating with Slack.
//
//    Parameters:
//      - code: the OAuth code, given by Slack
//      - error: redirects user to /auth?error=oauth-<error> when present

const database = new PrismaClient();

const SlackUserIdentitySchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    image_original: z.string().optional(),
    image_192: z.string().optional(),
});

const SlackAuthResponseSchema = z.object({
    ok: z.boolean(),
    app_id: z.string(),
    authed_user: z.object({
        id: z.string(),
        scope: z.string(),
        access_token: z.string(),
        token_type: z.string(),
    }),
    team: z.object({
        id: z.string(),
    }),
    enterprise: z.any().nullable(),
    is_enterprise_install: z.boolean(),
});

const SlackUserResponseSchema = z.object({
    ok: z.boolean(),
    user: SlackUserIdentitySchema,
});

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    logNextRequest("authSlack", req);

    if (req.method !== "GET")
        return res.status(405).redirect("/?error=invalid-method");

    const { code, error } = req.query;

    if (error)
        return res.redirect(`/?error=oauth-${error}`);

    if (!code || typeof code !== "string")
        return res.redirect("/?error=missing-code");

    const clientId = env.SLACK_CLIENT_ID;
    const clientSecret = env.SLACK_CLIENT_SECRET;

    try {
        const defaultUriBase = process.env.NODE_ENV == "development" ? "http://localhost:3000" : "https://lapse.hackclub.com";
        const redirectUri = `${req.headers.origin || process.env.NEXTAUTH_URL || defaultUriBase}/api/authSlack`;
        
        const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                redirect_uri: redirectUri,
            }),
        });

        const tokenDataRaw = await tokenResponse.json();
        const tokenDataResult = SlackAuthResponseSchema.safeParse(tokenDataRaw);

        if (!tokenDataResult.success) {
            logError("authSlack", "Invalid token response format.", { error: tokenDataResult.error, tokenDataRaw });
            return res.redirect("/?error=invalid-token-response");
        }

        const tokenData = tokenDataResult.data;

        if (!tokenData.ok) {
            logError("authSlack", "Failed to exchange code for token!", { tokenData });
            return res.redirect("/?error=token-exchange-failed");
        }

        const userResponse = await fetch("https://slack.com/api/users.identity", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${tokenData.authed_user.access_token}`,
            },
        });

        const userDataRaw = await userResponse.json();
        const userDataResult = SlackUserResponseSchema.safeParse(userDataRaw);

        if (!userDataResult.success) {
            logError("authSlack", "Invalid user response format.", { error: userDataResult.error });
            return res.redirect("/?error=invalid-user-response");
        }

        const userData = userDataResult.data;

        if (!userData.ok) {
            logError("authSlack", "Failed to fetch user profile.", { userData });
            return res.redirect("/?error=profile-fetch-failed");
        }

        const slackUser = userData.user;

        let dbUser = await database.user.findFirst({
            where: {
                OR: [{ slackId: slackUser.id }, { email: slackUser.email }],
            },
        });

        if (!dbUser) {
            // The user is creating a new account via Slack.
            const baseHandle = slackUser.name.toLowerCase().replace(/[^a-z0-9]/g, "");
            let handle = baseHandle;
            let counter = 1;

            while (await database.user.findFirst({ where: { handle } })) {
                handle = `${baseHandle}${counter}`;
                counter++;
            }

            dbUser = await database.user.create({
                data: {
                    email: slackUser.email,
                    slackId: slackUser.id,
                    handle: handle,
                    displayName: slackUser.name,
                    profilePictureUrl: slackUser.image_original || slackUser.image_192 || "",
                    bio: "",
                    urls: [],
                    permissionLevel: "USER",
                    createdAt: new Date(),
                    hackatimeApiKey: null,
                },
            });
        }
        else {
            // The user already signed up for Lapse - link their Slack ID with the account.
            dbUser = await database.user.update({
                where: { id: dbUser.id },
                data: { 
                    slackId: slackUser.id,
                    profilePictureUrl: slackUser.image_original || slackUser.image_192 || dbUser.profilePictureUrl,
                },
            });
        }

        const authToken = generateJWT(dbUser.id, dbUser.email);
        res.setHeader("Set-Cookie", [
            `lapse-auth=${authToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, // 30 days
        ]);

        return res.redirect("/?auth=success");
    }
    catch (error) {
        logError("authSlack", "Slack OAuth error!", { error });
        return res.redirect("/?error=server-error");
    }
}
