import { z } from "zod";
import { implement, ORPCError, os } from "@orpc/server";
import { authRouterContract, MAX_HANDLE_LENGTH, MIN_HANDLE_LENGTH, type OAuthErrorCode } from "@hackclub/lapse-api";
import { createHash, randomBytes } from "node:crypto";

import * as db from "@/generated/prisma/client.js";

import { logMiddleware, requiredAuth, type Context } from "@/router.js";
import { getTimelapseById } from "@/routers/timelapse.js";
import { apiErr, apiOk, Err } from "@/common.js";
import { database } from "@/db.js";
import { env } from "@/env.js";
import { getCookie, setCookie } from "@orpc/server/helpers";
import { logError, logInfo, logWarning } from "@/logging.js";
import { oneOf } from "@hackclub/lapse-shared";
import { HackatimeOAuthApi } from "@/hackatime.js";
import { slackQueryProfile } from "@/slack.js";
import { oauth } from "@/oauth.js";

const osc = implement(authRouterContract)
    .$context<Context>()
    .use(logMiddleware);

const OAUTH_COOKIE_NAME = "lapse_oauthdata";
const HKT_REDIRECT_URI = `${env.BASE_URL}/auth/hackatimeCallback`; // should point to an actual endpoint we have defined below!

type OAuthCookie = z.infer<typeof OAuthCookieSchema>;
const OAuthCookieSchema = z.object({
    // We use extremely short names for these fields, as they will be stored in a cookie that's JSON+Base64 encoded.
    // Ideally, for internal transport, we want to save as many bytes as we can.

    /**
     * The **H**ackatime **st**ate we used for Hackatime authentication. Unrelated to the state given by the authorizing client.
     */
    hst: z.base64url(),

    /**
     * The **H**ackatime **c**ode **v**erifier we used for Hackatime authentication. Unrelated to the state given by the authorizing client.
     */
    hcv: z.base64url(),

    /**
     * The given redirect URI.
     */
    rd: z.url(),

    /**
     * The ID of the authorizing client.
     */
    ci: z.string()
});

/**
 * Returned by Hackatime when finalizing token exchange via /oauth/token.
 */
type HackatimeTokenResponse = z.infer<typeof HackatimeTokenResponseSchema>;
const HackatimeTokenResponseSchema = z.object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number(),
    refresh_token: z.string().optional(),
});

export default osc.router({
    authorize: osc.authorize // note: user-agent endpoint
        .handler(async (req) => {
            const state = randomBytes(16).toString("base64url");
            const codeVerifier = randomBytes(32).toString("base64url");
            const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

            setCookie(
                req.context.resHeaders,
                OAUTH_COOKIE_NAME,
                Buffer.from(JSON.stringify(
                    {
                        hst: state,
                        hcv: codeVerifier,
                        rd: req.input.query.redirect_uri,
                        ci: req.input.query.client_id
                    } satisfies OAuthCookie
                )).toString("base64url"),
                {
                    path: "/",
                    httpOnly: true,
                    sameSite: "lax",
                    maxAge: 600,
                    secure: process.env["NODE_ENV"] === "production"
                }
            );

            const url = new URL(`${env.HACKATIME_URL}/oauth/authorize`);
            url.searchParams.set("client_id", env.HACKATIME_CLIENT_ID);
            url.searchParams.set("response_type", "code");
            url.searchParams.set("scope", "profile");
            url.searchParams.set("redirect_uri", HKT_REDIRECT_URI);
            url.searchParams.set("state", state);
            url.searchParams.set("code_challenge", codeChallenge);
            url.searchParams.set("code_challenge_method", "S256");

            // The user authenticates, and then we go to /auth/hackatimeCallback.
            return {
                headers: {
                    location: url.href
                }
            };
        }), 

    internal: {
        hackatimeCallback: os
            .$context<Context>()
            .route({
                method: "GET",
                path: "/internal/hackatimeCallback",
                inputStructure: "detailed",
                outputStructure: "detailed",
                successStatus: 307
            })
            .input(z.object({
                query: z.object({
                    code: z.string().optional(),
                    state: z.string().optional(),
                    error: z.string().optional()
                })
            }))
            .handler(async (req) => {
                const cookie = getCookie(req.context.reqHeaders, OAUTH_COOKIE_NAME);
                if (!cookie) {
                    // Hm. No cookie means we don't know where this request came from.
                    logWarning(`Couldn't find the ${OAUTH_COOKIE_NAME} cookie for an authenticating Hackatime user.`);
                    throw new ORPCError("BAD_REQUEST", {
                        message: `Cannot find OAuth2 cookie ${OAUTH_COOKIE_NAME} - make sure you have cookies enabled and try again.`
                    });
                }

                let oauthData: z.infer<typeof OAuthCookieSchema>;
                try {
                    const result = OAuthCookieSchema.safeParse(
                        JSON.parse(Buffer.from(cookie, "base64url").toString("utf8"))
                    );

                    if (!result.success) {
                        logError("Invalid OAuth cookie schema!", { cookie, error: result.error });
                        throw new ORPCError("BAD_REQUEST", {
                            message: `Invalid OAuth2 cookie schema - please try clearing cookies and authenticating again.`
                        });
                    }
                    
                    oauthData = result.data;
                }
                catch (error) {
                    logError("Couldn't parse OAuth cookie!", { error });
                    throw new ORPCError("BAD_REQUEST", {
                        message: `Cannot parse OAuth2 cookie - please try clearing cookies and authenticating again.`
                    });
                }

                function errorRedirect(error: OAuthErrorCode) {
                    const url = new URL(oauthData.rd);
                    url.searchParams.set("error", error);
                    return { headers: { location: url.href } };
                }
                
                if (req.input.query.error) {
                    if (req.input.query.error != "access_denied") {
                        // We expect access denied - that happens when the user clicks "Deny"
                        // on Hackatime's modal. Otherwise, something went wrong, and we should log it.
                        logError(`Hackatime returned OAuth error ${req.input.query.error}!`, {
                            queryParams: req.input.query,
                            redirectUri: oauthData.rd
                        });
                    }

                    return errorRedirect(`upstream_${req.input.query.error}` as OAuthErrorCode);
                }

                if (!req.input.query.code || !req.input.query.state) {
                    logError("Hackatime didn't give us either 'code' or 'state'!");
                    return errorRedirect("upstream_data_missing");
                }

                if (req.input.query.state !== oauthData.hst) {
                    logError(`Hackatime OAuth state mismatch! Expected ${oauthData.hst}, got ${req.input.query.state}.`);
                    return errorRedirect("upstream_state_mismatch");
                }

                // CSRF and preliminary checks done, time to exchange our temporary authorization code for a  more permanent access token.
                const res = await fetch(`${env.HACKATIME_URL}/oauth/token`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                        client_id: env.HACKATIME_CLIENT_ID,
                        code: req.input.query.code,
                        grant_type: "authorization_code",
                        redirect_uri: HKT_REDIRECT_URI,
                        code_verifier: oauthData.hcv
                    })
                });

                if (!res.ok) {
                    const errBody = await res.text();
                    logError(`Token exchange between Hackatime and Lapse failed! HTTP ${res.status}, ${errBody}`, { errBody });
                    return errorRedirect("upstream_token_exchange_failed");
                }

                let tokenData: HackatimeTokenResponse;
                try {
                    const payload = await res.json();
                    const parseResult = HackatimeTokenResponseSchema.safeParse(payload);

                    if (!parseResult.success) {
                        logError(`Hackatime returned an unexpected response for /oauth/token! ${parseResult.error}`, {
                            error: parseResult.error,
                            payload
                        });

                        return errorRedirect("upstream_data_malformed");
                    }

                    tokenData = parseResult.data;
                }
                catch (err) {
                    logError(`Hackatime returned a non-JSON response!`, { err });
                    return errorRedirect("upstream_data_malformed");
                }

                // Nice! We got our access token. Now, let's see who just logged in...
                const hkt = new HackatimeOAuthApi(tokenData.access_token);
                const hktUser = await hkt.me();

                if (hktUser.emails.length == 0) {
                    logError(`No e-mails found for user ${hktUser.id} (SID ${hktUser.slack_id}, GitHub @${hktUser.github_username})!`);
                    return errorRedirect("upstream_data_missing");
                }

                const slack = hktUser.slack_id ? await slackQueryProfile(hktUser.slack_id) : null;

                let dbUser = await database().user.findFirst({
                    where: { hackatimeId: hktUser.id.toString() }
                });

                if (!dbUser && hktUser.slack_id) {
                    // We might be dealing with a user that has last logged in when we weren't using Hackatime OAuth.
                    // This is a bit odd, as that is ancient history, but we handle this nonetheless.
                    dbUser = await database().user.findFirst({
                        where: { slackId: hktUser.slack_id }
                    });
                }

                // We update the user's profile picture on each login, not just when they register.
                const pfp = slack?.profile.image_512 ??
                    slack?.profile.image_192 ??
                    slack?.profile.image_original ??
                    slack?.profile.image_72 ??
                    slack?.profile.image_48 ??
                    slack?.profile.image_32 ??
                    slack?.profile.image_24 ??
                    env.DEFAULT_PFP_URL;

                if (!dbUser) {
                    // User doesn't exist. Let's create an account for them!
                    // For handles, we try to use Slack first, but, if it's not available, we use the e-mail.
                    // Generally, e-mails should be avoided as they can expose real/dead names.
                    let baseHandle = slack ? slack.profile.display_name : hktUser.emails[0].split("@")[0];
                    baseHandle = baseHandle.toLowerCase().replace(/[^a-z0-9]/g, "")
                        .slice(0, MAX_HANDLE_LENGTH)
                        .padEnd(MIN_HANDLE_LENGTH);

                    let handle = baseHandle;
                    let increment = 1;

                    // Try to find a non-taken handle
                    while (await database().user.findFirst({ where: { handle } })) {
                        const suffix = increment.toString();
                        handle = `${baseHandle.slice(0, MAX_HANDLE_LENGTH - suffix.length)}${suffix}`;
                        increment++;
                    }

                    dbUser = await database().user.create({
                        data: {
                            email: hktUser.emails[0],
                            hackatimeId: hktUser.id.toString(),
                            hackatimeAccessToken: tokenData.access_token,
                            hackatimeRefreshToken: tokenData.refresh_token || null,
                            slackId: hktUser.slack_id || null,
                            handle: handle,
                            displayName: slack ? slack.profile.display_name : baseHandle,
                            profilePictureUrl: pfp,
                            bio: slack?.profile.title ?? "",
                            urls: [],
                            permissionLevel: "USER",
                            createdAt: new Date()
                        },
                    });

                    logInfo(`User account for ${handle} created - welcome!`, { slack, hktUser });
                }
                else {
                    // User already exists, so we just refresh some fields.
                    dbUser = await database().user.update({
                        where: { id: dbUser.id },
                        data: {
                            hackatimeId: hktUser.id.toString(), // in case of old Slack-based migration
                            hackatimeAccessToken: tokenData.access_token,
                            hackatimeRefreshToken: tokenData.refresh_token,
                            slackId: hktUser.slack_id || undefined,
                            profilePictureUrl: pfp != env.DEFAULT_PFP_URL ? pfp : undefined
                        }
                    });
                }

                // Yay! Now we have the database user associated with the Hackatime account we just logged in with.
                // It's time to go through *our own* OAuth flow now.

                // We want to take the user to a consent screen, where they will be presented with all of the scopes the app
                // needs, as well as its name, trust status, etc... however, *something* needs to handle that screen, and that
                // should NOT be the API (as, well, we're everything-related-to-user-interfacing-agnostic). We trust one "canonical"
                // (first-party) web client to do this. This blessed client gets the unique ability to completely skip consent (MonkaS)
                // so that it, itself, can verify it.
                //
                // The consent modal should report back with its ruling to /auth/continue with a valid `Authorization` HTTP header.
                // That header is REQUIRED to have the bearer token of the user that is trying to authorize.
                
                if (oauthData.ci == env.CANONICAL_OAUTH_CLIENT_ID) {
                    // This is our canonical client. We go straight to the point, dishing out the code.
                    
                    const url = new URL(`${env.BASE_URL}/auth/authorize`);
                    url.searchParams.set("client_id", oauthData.ci);
                    url.searchParams.set()

                    await oauth.authorize(
                        new Request(`${env.BASE_URL}/auth/authorize`, {
                            
                        })
                    )
                }
            })
    }
});
