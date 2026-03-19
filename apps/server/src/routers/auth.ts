import { z } from "zod";
import { implement, ORPCError } from "@orpc/server";
import { authRouterContract, MAX_HANDLE_LENGTH, MIN_HANDLE_LENGTH, type OAuthErrorCode } from "@hackclub/lapse-api";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import OAuth2Server from "@node-oauth/oauth2-server";
import { deleteCookie, getCookie, setCookie } from "@orpc/server/helpers";
import { arraysEqual } from "@hackclub/lapse-shared";

import { logMiddleware, requiredAuth, requiredScopes, requiredImplicitUser, type Context } from "@/router.js";
import { database } from "@/db.js";
import { env } from "@/env.js";
import { logError, logInfo, logWarning } from "@/logging.js";
import { HackatimeOAuthApi } from "@/hackatime.js";
import { slackQueryProfile } from "@/slack.js";
import { oauthSrv } from "@/oauth.js";

const os = implement(authRouterContract)
    .$context<Context>()
    .use(logMiddleware);

const OAUTH_COOKIE_NAME = "lapse_oauthdata";
const HKT_REDIRECT_URI = `${env.BASE_URL}/api/auth/hackatimeCallback`; // should point to an actual endpoint we have defined below!

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
    uri: z.url(),

    /**
     * The ID of the authorizing client.
     */
    cid: z.string(),

    /**
     * The requested scopes.
     */
    scp: z.string().array(),

    /**
     * The state provided by the authorizing client at the beginning of the OAuth2 exchange.
     */
    stt: z.string(),

    /**
     * The **c**ode **c**hallenge **v**alue provided by the authorizing client at the beginning of the OAuth2 exchange. The method is always assumed to be `S256`.
     */
    ccv: z.string()
});

type ConsentJwt = z.infer<typeof ConsentJwtSchema>;
const ConsentJwtSchema = z.object({
    /**
     * The ID of the user that has approved the consent.
     */
    sub: z.string(),

    /**
     * The client ID of the app to approve consent for.
     */
    cid: z.string(),

    /**
     * The scopes that were granted by the user.
     */
    scp: z.string().array()
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

function createConsentToken(data: ConsentJwt) {
    return jwt.sign(data, env.JWT_CONSENT_TOKENS, { expiresIn: "60s" });
}

function readOAuthCookie(reqHeaders?: Headers) {
    const cookie = getCookie(reqHeaders, OAUTH_COOKIE_NAME);
    if (!cookie) {
        // Hm. No cookie means we don't know where this request came from.
        logWarning(`Couldn't find the ${OAUTH_COOKIE_NAME} cookie when handling the Hackatime callback.`);
        throw new ORPCError("BAD_REQUEST", {
            message: `Cannot find OAuth2 cookie ${OAUTH_COOKIE_NAME} - make sure you have cookies enabled and try again.`
        });
    }

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
        
        return result.data;
    }
    catch (error) {
        logError("Couldn't parse OAuth cookie!", { error });
        throw new ORPCError("BAD_REQUEST", {
            message: `Cannot parse OAuth2 cookie - please try clearing cookies and authenticating again.`
        });
    }
}

export default os.router({
    authorize: os.authorize // note: user-agent endpoint
         .handler(async (req) => {
            if (!req.context.resHeaders)
                throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Couldn't access response headers." });

            const state = randomBytes(16).toString("base64url");
            const codeVerifier = randomBytes(32).toString("base64url");
            const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

            setCookie(
                req.context.resHeaders,
                OAUTH_COOKIE_NAME,
                Buffer.from(
                    JSON.stringify({
                        hst: state,
                        hcv: codeVerifier,
                        uri: req.input.query.redirect_uri,
                        cid: req.input.query.client_id,
                        scp: req.input.query.scope.split(" "),
                        stt: req.input.query.state,
                        ccv: req.input.query.code_challenge
                    } satisfies OAuthCookie)
                ).toString("base64url"),
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
            req.context.resHeaders.append("location", url.href);
            return { status: 307 };
         }),

    grantConsent: os.grantConsent
        .use(requiredAuth())
        .use(requiredScopes("elevated"))
        .use(requiredImplicitUser())
        .handler(async (req) => {
            return {
                token: createConsentToken({
                    sub: req.context.user.id,
                    cid: req.input.clientId,
                    scp: req.input.scopes
                })
            };
        }),

    // The routes below are not defined in the contracts, as we don't want the client to be calling them directly! We only want to access them through redirects.
    hackatimeCallback: os.hackatimeCallback
        .handler(async (req) => {
            const oauthData = readOAuthCookie(req.context.reqHeaders);

            function errorRedirect(error: OAuthErrorCode): { status: 307; headers: Record<string, string> } {
                deleteCookie(req.context.resHeaders, OAUTH_COOKIE_NAME);

                const url = new URL(oauthData.uri);
                url.searchParams.set("error", error);
                return { status: 307, headers: { location: url.href } };
            }
            
            if (req.input.query.error) {
                if (req.input.query.error != "access_denied") {
                    // We expect access denied - that happens when the user clicks "Deny"
                    // on Hackatime's modal. Otherwise, something went wrong, and we should log it.
                    logError(`Hackatime returned OAuth error ${req.input.query.error}!`, {
                        queryParams: req.input.query,
                        redirectUri: oauthData.uri
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

            // CSRF and preliminary checks done, time to exchange our temporary authorization code for a more permanent access token.
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
                let baseHandle = (
                    slack ? 
                        (slack.profile.display_name || slack.profile.real_name || slack.profile.real_name_normalized) :
                    hktUser.github_username ?
                        hktUser.github_username :
                    (hktUser.emails.length > 0) ?
                        hktUser.emails[0].split("@")[0] :
                    hktUser.slack_id ?? "user"
                );
                    
                baseHandle = baseHandle.toLowerCase().replace(/[^a-z0-9]/g, "_")
                    .slice(0, MAX_HANDLE_LENGTH);

                if (baseHandle.length < MIN_HANDLE_LENGTH) {
                    baseHandle = baseHandle.padEnd(MIN_HANDLE_LENGTH, "0");
                }

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
                        displayName: ((slack?.profile.display_name || slack?.profile.real_name) || baseHandle).slice(0, 24) || "User",
                        profilePictureUrl: pfp,
                        bio: slack?.profile.title ?? "",
                        urls: [],
                        permissionLevel: "USER"
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
            
            // If this is our canonical client, we go straight to the point, just giving them the code. Consent is implicit here.
            if (oauthData.cid == env.CANONICAL_OAUTH_CLIENT_ID) {
                const url = new URL(`${env.BASE_URL}/api/auth/continue`);
                url.searchParams.set("consentToken", createConsentToken({
                    cid: oauthData.cid,
                    scp: oauthData.scp,
                    sub: dbUser.id
                }));

                return { status: 307, headers: { location: url.href } };
            }

            // Otherwise, consent must be explicit (this is a third-party app), so we redirect the user to our canonical client to confirm.
            // If the user ALSO needs to authenticate on the canonical client, we go through the same steps, but the branch above is met, so we don't get an infinite loop.
            const url = new URL(env.CONSENT_URL);
            url.searchParams.set("clientId", oauthData.cid);
            url.searchParams.set("scopes", oauthData.scp.join(" "));
            return { status: 307, headers: { location: url.href } };
            }),

    // This endpoint is called after the user gives the requesting app consent to get a token to their account. For canonical apps, as no consent modal has to be displayed, the user
    // is immidiately redirected to /auth/continue.
    continue: os.continue
       .handler(async (req) => {
           let consent: ConsentJwt;

           try {
               consent = ConsentJwtSchema.parse(
                   jwt.verify(req.input.query.consentToken, env.JWT_CONSENT_TOKENS)
               );
           }
           catch (err) {
               logWarning(`/auth/continue was called with an invalid/malformed access token; error ${err}`, { token: req.input.query.consentToken, err });
               throw new ORPCError("BAD_REQUEST", {
                   message: "Consent token was malformed or invalid."
               });
           }

           const oauthData = readOAuthCookie(req.context.reqHeaders);
           
           if (
               consent.cid !== oauthData.cid ||
               !arraysEqual(consent.scp, oauthData.scp)
           ) {
               logWarning(`Provided consent token (${consent.cid}, ${consent.scp.join(" ")}) doesn't match OAuth cookie (${oauthData.cid}, ${oauthData.scp.join(" ")})`, { oauthData, consent });
               throw new ORPCError("BAD_REQUEST", {
                   message: "Consent token does not match cookie data."
               });
           }

           const oauthResponse = new OAuth2Server.Response();
           await oauthSrv.authorize(
               new OAuth2Server.Request({
                   method: "GET",
                   headers: {},
                   query: {
                       "response_type": "code",
                       "client_id": oauthData.cid,
                       "redirect_uri": oauthData.uri,
                       "scope": oauthData.scp.join(" "),
                       "state": oauthData.stt,
                       "code_challenge": oauthData.ccv,
                       "code_challenge_method": "S256"
                   }
               }),
               oauthResponse,
               {
                   authenticateHandler: {
                       handle: () => ({ id: consent.sub }),
                   },
               }
           );

           return {
               status: 307 as const,
               headers: oauthResponse.headers ?? {},
               body: oauthResponse.body
           };
       }),

    token: os.token
        .handler(async (req) => {
            const oauthResponse = new OAuth2Server.Response();
            const token = await oauthSrv.token(
                new OAuth2Server.Request({
                    method: "POST",
                    query: {},
                    body: req.input.body,
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        "content-length": req.context.req.headers["content-length"]!
                    }
                }),
                oauthResponse
            );
        
            return {
                status: 200,
                headers: {},
                body: {
                    access_token: token.accessToken,
                    expires_in: Math.max(
                        0,
                        Math.floor((token.accessTokenExpiresAt!.getTime() - Date.now()) / 1000)
                    ),
                    refresh_token: token.refreshToken!,
                    token_type: "Bearer",
                    scope: token.scope?.join(" ") ?? ""
                }
            };
        })
});
