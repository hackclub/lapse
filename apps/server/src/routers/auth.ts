import { z } from "zod";
import { implement, ORPCError } from "@orpc/server";
import { authRouterContract, MAX_BIO_LENGTH, MAX_HANDLE_LENGTH, MIN_HANDLE_LENGTH, type OAuthErrorCode } from "@hackclub/lapse-api";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import OAuth2Server from "@node-oauth/oauth2-server";
import { deleteCookie, getCookie, setCookie } from "@orpc/server/helpers";
import { arraysEqual } from "@hackclub/lapse-shared";

import { logMiddleware, type Context } from "@/router.js";
import { authorize } from "@/policies.js";
import { database, redis } from "@/db.js";
import { env } from "@/env.js";
import { logError, logInfo, logWarning } from "@/logging.js";
import { HackatimeOAuthApi } from "@/hackatime.js";
import { slackQueryProfile } from "@/slack.js";
import { checkAccessToken, issueSessionTokenFrom, oauthSrv, revokeAccessToken, verifySecretHash } from "@/oauth.js";
import { isFromWebsite, sessionCookieOf, setSessionCookie } from "@/session.js";
import { apiErr, apiOk } from "@/common.js";
import type * as safe from "@/secrets.js";

const os = implement(authRouterContract)
    .$context<Context>()
    .use(logMiddleware);

const OAUTH_COOKIE_NAME = "lapse_oauthdata";
const THIRD_PARTY_OAUTH_COOKIE_NAME = "lapse_oauthdata_3p";
const PASSWORD_FAILURES_KEY = "lapse:passwordSignIn:failures";
const PASSWORD_MAX_FAILURES = 20;
const PASSWORD_FAILURE_WINDOW = 15 * 60;

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

/**
 * The bio starts out as the user's Slack title, and keeps following it for as long as it still reads exactly what
 * we last copied (`slackTitle`). Writing their own bio in Lapse breaks the match, and from then on it's theirs.
 *
 * Accounts from before we tracked this have no `slackTitle`, so a bio copied from Slack and one written by hand
 * look the same. Those are left alone - unless the bio is empty, which has nothing to lose, or already matches the
 * Slack title, which is as good as having copied it.
 */
function bioFromSlack(user: safe.User, title: string): Pick<safe.User, "bio" | "slackTitle"> | null {
    if (user.slackTitle === null ? (user.bio === "" || user.bio === title) : user.bio === user.slackTitle)
        return { bio: title, slackTitle: title };

    return null;
}

function createConsentToken(data: ConsentJwt) {
    return jwt.sign(data, env.JWT_CONSENT_TOKENS, { expiresIn: "60s" });
}

/**
 * Third-party flows keep their own cookie, as the consent screen may need to sign the user into the canonical client
 * first. That nested canonical flow would otherwise overwrite the third-party app's data, leaving `/auth/continue`
 * unable to redirect back to it.
 */
function oauthCookieName(clientId: string) {
    return clientId === env.CANONICAL_OAUTH_CLIENT_ID ? OAUTH_COOKIE_NAME : THIRD_PARTY_OAUTH_COOKIE_NAME;
}

function parseOAuthCookie(reqHeaders: Headers | undefined, name: string): OAuthCookie | null {
    const cookie = getCookie(reqHeaders, name);
    if (!cookie)
        return null;

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
        if (error instanceof ORPCError)
            throw error;

        logError("Couldn't parse OAuth cookie!", { error });
        throw new ORPCError("BAD_REQUEST", {
            message: `Cannot parse OAuth2 cookie - please try clearing cookies and authenticating again.`
        });
    }
}

function missingOAuthCookie(name: string) {
    // Hm. No cookie means we don't know where this request came from.
    logWarning(`Couldn't find the ${name} cookie when handling an OAuth2 request.`);
    return new ORPCError("BAD_REQUEST", {
        message: `Cannot find OAuth2 cookie ${name} - make sure you have cookies enabled and try again.`
    });
}

function readOAuthCookie(reqHeaders: Headers | undefined, name: string) {
    const data = parseOAuthCookie(reqHeaders, name);
    if (!data)
        throw missingOAuthCookie(name);

    return data;
}

/**
 * Finds the cookie of the flow Hackatime is calling back for. Both a third-party and a canonical flow may be in
 * progress at once, so we match on the Hackatime state.
 */
function readHackatimeCallbackCookie(reqHeaders: Headers | undefined, state: string | undefined) {
    const candidates = [OAUTH_COOKIE_NAME, THIRD_PARTY_OAUTH_COOKIE_NAME]
        .map(name => ({ name, data: parseOAuthCookie(reqHeaders, name) }))
        .filter((x): x is { name: string; data: OAuthCookie } => x.data !== null);

    const match = candidates.find(x => x.data.hst === state) ?? candidates[0];
    if (!match)
        throw missingOAuthCookie(OAUTH_COOKIE_NAME);

    return match;
}

export default os.router({
    authorize: os.authorize // note: user-agent endpoint
         .use(authorize("auth.authorize"))
         .handler(async (req) => {
            if (!req.context.resHeaders)
                throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Couldn't access response headers." });

            // Everything after this sends the browser to `redirect_uri` - including when Hackatime reports an error,
            // which happens before /auth/continue gets to check it. So check it now, the same way that will: it must be
            // one the app registered, exactly. Otherwise this would bounce anyone to any site from our own domain.
            const client = await database().serviceClient.findFirst({
                where: { clientId: req.input.query.client_id, revokedAt: null },
                select: { redirectUris: true }
            });

            if (!client || !client.redirectUris.includes(req.input.query.redirect_uri)) {
                logWarning(`Refused to start OAuth for client ${req.input.query.client_id}: unknown or revoked client, or unregistered redirect URI.`, { redirectUri: req.input.query.redirect_uri });
                throw new ORPCError("BAD_REQUEST", { message: "That app doesn't exist, or it isn't allowed to send you there." });
            }

            const state = randomBytes(16).toString("base64url");
            const codeVerifier = randomBytes(32).toString("base64url");
            const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

            setCookie(
                req.context.resHeaders,
                oauthCookieName(req.input.query.client_id),
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
            url.searchParams.set("scope", "profile read");
            url.searchParams.set("redirect_uri", HKT_REDIRECT_URI);
            url.searchParams.set("state", state);
            url.searchParams.set("code_challenge", codeChallenge);
            url.searchParams.set("code_challenge_method", "S256");

            // The user authenticates, and then we go to /auth/hackatimeCallback.
            req.context.resHeaders.append("location", url.href);
            return { status: 307 };
         }),

    grantConsent: os.grantConsent
        .use(authorize("auth.grantConsent"))
        .handler(async (req) => {
            const client = await database().serviceClient.findFirst({
                where: { clientId: req.input.clientId, revokedAt: null }
            });

            if (!client)
                throw new ORPCError("NOT_FOUND", { message: "That app doesn't exist." });

            // Consent for the website's own client is only ever given by signing in through Hackatime (see
            // `hackatimeCallback`). If a session could grant it to itself here, it could mint itself a brand new
            // session - and with it a fresh sign-in time - without anybody having signed in at all.
            if (client.clientId === env.CANONICAL_OAUTH_CLIENT_ID)
                throw new ORPCError("FORBIDDEN", { message: "Consent for this app can't be granted here." });

            const disallowedScopes = req.input.scopes.filter(scope =>
                !client.scopes.includes(scope) ||
                (scope === "elevated" && client.clientId !== env.CANONICAL_OAUTH_CLIENT_ID)
            );

            if (disallowedScopes.length > 0)
                throw new ORPCError("FORBIDDEN", { message: `This app can't request the scopes ${disallowedScopes.join(", ")}.` });

            return {
                token: createConsentToken({
                    sub: req.context.user.id,
                    cid: req.input.clientId,
                    scp: req.input.scopes
                })
            };
        }),

    // For the one account that can't sign in through Hackatime (app store review). The rest of the flow is the regular
    // one: the client gets an authorization code bound to its PKCE challenge, and exchanges it at /auth/token.
    signInWithPassword: os.signInWithPassword
        .use(authorize("auth.signInWithPassword"))
        .handler(async (req) => {
            const email = env.PASSWORD_SIGN_IN_EMAIL?.trim().toLowerCase();
            const hash = env.PASSWORD_SIGN_IN_HASH;
            const rejected = apiErr("NO_PERMISSION", "That e-mail and password don't match.");

            if (!email || !hash)
                return rejected;

            if (req.input.clientId !== env.CANONICAL_OAUTH_CLIENT_ID)
                return rejected;

            // Any other e-mail can never sign in here, so it's turned down without counting against the account or
            // spending a hash on it. Only guesses at the account's own password count, so nobody can lock App Review
            // out without knowing its e-mail.
            if (req.input.email.trim().toLowerCase() !== email)
                return rejected;

            let failures = 0;
            try {
                failures = Number(await redis().get(PASSWORD_FAILURES_KEY) ?? 0);
            }
            catch (err) {
                logWarning("Couldn't read password sign-in failures from Redis.", { err });
            }

            if (failures >= PASSWORD_MAX_FAILURES)
                return apiErr("NO_PERMISSION", "Too many attempts. Please try again later.");

            if (!verifySecretHash(req.input.password, hash)) {
                try {
                    const count = await redis().incr(PASSWORD_FAILURES_KEY);
                    if (count === 1)
                        await redis().expire(PASSWORD_FAILURES_KEY, PASSWORD_FAILURE_WINDOW);
                }
                catch (err) {
                    logWarning("Couldn't count a failed password sign-in in Redis.", { err });
                }

                logWarning("Failed password sign-in.", { failures: failures + 1 });
                return rejected;
            }

            let user = await database().user.findFirst({ where: { email, hackatimeId: null } });
            if (!user) {
                let handle = "appreview";
                for (let i = 1; await database().user.findFirst({ where: { handle } }); i++)
                    handle = `appreview${i}`;

                user = await database().user.create({
                    data: {
                        email,
                        handle,
                        displayName: "App Review",
                        profilePictureUrl: env.DEFAULT_PFP_URL,
                        urls: [],
                        permissionLevel: "USER"
                    }
                });

                logInfo(`Password sign-in account ${handle} created.`);
            }

            const oauthResponse = new OAuth2Server.Response();
            try {
                await oauthSrv.authorize(
                    new OAuth2Server.Request({
                        method: "GET",
                        headers: {},
                        query: {
                            "response_type": "code",
                            "client_id": req.input.clientId,
                            "redirect_uri": req.input.redirectUri,
                            "scope": req.input.scope,
                            "state": req.input.state,
                            "code_challenge": req.input.codeChallenge,
                            "code_challenge_method": "S256"
                        }
                    }),
                    oauthResponse,
                    {
                        authenticateHandler: {
                            handle: () => ({ id: user.id })
                        }
                    }
                );
            }
            catch (err) {
                logWarning("Password sign-in couldn't issue an authorization code.", { err });
                return apiErr("ERROR", "Something went wrong while signing in. Please try again.");
            }

            const location = oauthResponse.headers?.["location"];
            if (typeof location !== "string")
                return apiErr("ERROR", "Something went wrong while signing in. Please try again.");

            logInfo(`Password sign-in for ${user.handle}.`);
            return apiOk({ redirectUri: location });
        }),

    // The routes below are not defined in the contracts, as we don't want the client to be calling them directly! We only want to access them through redirects.
    hackatimeCallback: os.hackatimeCallback
        .use(authorize("auth.hackatimeCallback"))
        .handler(async (req) => {
            const { name: cookieName, data: oauthData } = readHackatimeCallbackCookie(req.context.reqHeaders, req.input.query.state);

            function errorRedirect(error: OAuthErrorCode): { status: 307; headers: Record<string, string> } {
                deleteCookie(req.context.resHeaders, cookieName);

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
                // Expected when a second sign-in was started (e.g. in another tab) before the first came back, since
                // that overwrites the cookie. The user is redirected with an error and can just try again.
                logWarning(`Hackatime OAuth state mismatch! Expected ${oauthData.hst}, got ${req.input.query.state}.`);
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
            const slackTitle = (slack?.profile.title ?? "").slice(0, MAX_BIO_LENGTH);

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
                        bio: slackTitle,
                        slackTitle: slack ? slackTitle : null,
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
                        profilePictureUrl: pfp != env.DEFAULT_PFP_URL ? pfp : undefined,
                        // Only with a Slack profile in hand - a failed lookup isn't an empty title.
                        ...(slack ? bioFromSlack(dbUser, slackTitle) : null)
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
       .use(authorize("auth.continue"))
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

           const cookieName = oauthCookieName(consent.cid);
           const oauthData = readOAuthCookie(req.context.reqHeaders, cookieName);
           
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

           deleteCookie(req.context.resHeaders, cookieName);

           return {
               status: 307 as const,
               headers: oauthResponse.headers ?? {},
               body: oauthResponse.body
           };
       }),

    // The website used to keep its access token in `localStorage`. This moves it into the session cookie, in two
    // calls: the first hands out the cookie, and the second - which the browser makes *with* that cookie - revokes
    // the old token. A browser that turns out not to keep the cookie never makes the second call, so it is left
    // with a token that still works rather than signed out.
    session: os.session
        .use(authorize("auth.session"))
        .handler(async (req) => {
            // Only pages of the website have a session cookie. Anything else keeps its token.
            if (env.SESSION_COOKIES === "off" || !isFromWebsite(req.context.req))
                return apiOk({ mode: "bearer" as const });

            const presented = await checkAccessToken(req.input.token);
            if (presented.status === "unknown")
                throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Couldn't check that token right now." });

            // Already moved (by another tab, most likely), or simply dead. Either way it's of no more use to the
            // browser, and whether there is a session is now up to the cookie.
            if (presented.status === "invalid")
                return apiOk({ mode: "cookie" as const });

            const { token, actor } = presented;
            if (token.cid !== env.CANONICAL_OAUTH_CLIENT_ID || !token.scp.includes("elevated"))
                return apiOk({ mode: "bearer" as const });

            const current = req.context.actor;
            const hasSession = sessionCookieOf(req.context.req) !== null && current?.kind === "USER" && current.user.id === actor.user.id;

            if (!req.input.confirm) {
                if (!hasSession) {
                    const session = issueSessionTokenFrom(token, actor.authenticatedAt);
                    setSessionCookie(req.context.resHeaders, session.accessToken, session.expiresAt);
                }

                return apiOk({ mode: "cookie" as const });
            }

            // The cookie didn't come back, so this browser can't be relying on it.
            if (!hasSession)
                return apiOk({ mode: "bearer" as const });

            await revokeAccessToken(req.input.token);
            logInfo(`Moved the session of ${actor.user.handle} into a cookie.`);

            return apiOk({ mode: "cookie" as const });
        }),

    token: os.token
        .use(authorize("auth.token"))
        .handler(async (req) => {
            const oauthResponse = new OAuth2Server.Response();
            const authorization = req.context.req.headers.authorization;

            // Once the website's sessions live only in cookies, a code issued for the website's own sign-in page may
            // only be redeemed by the website - as a cookie. Otherwise a script on the page could start a sign-in of its
            // own, read the code off the redirect, and redeem it somewhere else for a token. The mobile app has its own
            // redirect URI, so it isn't affected. Checked before the exchange, which uses up the code.
            const websiteCode = req.input.body.client_id === env.CANONICAL_OAUTH_CLIENT_ID
                && req.input.body.redirect_uri.startsWith(`${env.WEB_BASE_URL}/`);

            if (env.SESSION_COOKIES === "only" && websiteCode && !isFromWebsite(req.context.req))
                throw new ORPCError("FORBIDDEN", { message: "Sign-ins to the Lapse website can only be completed by the website." });

            let token: OAuth2Server.Token;
            try {
                token = await oauthSrv.token(
                    new OAuth2Server.Request({
                        method: "POST",
                        query: {},
                        body: req.input.body,
                        headers: {
                            "content-type": "application/x-www-form-urlencoded",
                            "content-length": req.context.req.headers["content-length"]!,
                            // Confidential clients may authenticate with HTTP Basic (RFC 6749 section 2.3.1).
                            ...(authorization ? { authorization } : {})
                        }
                    }),
                    oauthResponse
                );
            }
            catch (err) {
                // Bad credentials, codes or grants are the caller's mistake - answer with the OAuth status, not a 500.
                if (err instanceof OAuth2Server.OAuthError && err.code < 500)
                    throw new ORPCError(err.name.toUpperCase(), { status: err.code, message: err.message, cause: err });

                throw err;
            }

            // The website's own sign-in ends here with a cookie its scripts can't read, and no token at all in the
            // response - so nothing running on the page can walk away with one, not even by signing in afresh.
            // Everyone else (third-party apps, the mobile app) gets their token back as they always have.
            const wanted = env.SESSION_COOKIES === "only" || (env.SESSION_COOKIES === "on" && req.input.body.session === "cookie");
            const forWebsite = wanted && token.client.id === env.CANONICAL_OAUTH_CLIENT_ID && isFromWebsite(req.context.req);
            if (forWebsite)
                setSessionCookie(req.context.resHeaders, token.accessToken, token.accessTokenExpiresAt!);

            return {
                status: 200,
                headers: {},
                body: {
                    access_token: forWebsite ? "" : token.accessToken,
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
