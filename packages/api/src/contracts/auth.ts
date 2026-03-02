import z from "zod";

import { apiResult, LapseId } from "@/common";
import { UserDisplayName, UserHandle } from "@/contracts/user";
import { contract, NO_INPUT } from "@/internal";
import { TimelapseSchema } from "@/contracts/timelapse";

export type OAuthErrorCode = z.infer<typeof OAuthErrorCodeSchema>;
export const OAuthErrorCodeSchema = z.enum([
    "state_mismatch", // provided state is different from the one stored in cookie - possible CSRF
    "server_error", // something went wrong internally - yell at @ascpixi to the look at logs!

    // Any OAuth error that starts with "upstream_" is custom-defined by Lapse and indicates that something
    // went wrong while interfacing with Hackatime. This is not necessarily Hackatime's fault!
    "upstream_token_exchange_failed", // token exchange between Lapse and Hackatime failed
    "upstream_identity_query_failed", // we tried to ask Hackatime who the user is, but that failed
    "upstream_data_missing", // Hackatime didn't give us the data we need
    "upstream_data_malformed", // something's wrong with what Hackatime returned
    "upstream_state_mismatch", // state provided by Hackatime is different from the one stored in cookie - possible CSRF
    "upstream_server_error", // something went wrong with Hackatime
    "upstream_access_denied", // user denied Lapse's access to their Hackatime identity

    // The errors below directly map to the ones returned by Hackatime.
    // See https://github.com/hackclub/hackatime/blob/66f928ca2462372f9ba95b6efb929e33b1ced716/config/locales/doorkeeper.en.yml#L95-L109.
    "upstream_invalid_request",
    "upstream_invalid_redirect_uri",
    "upstream_unauthorized_client",
    "upstream_invalid_scope",
    "upstream_invalid_code_challenge_method",
    "upstream_temporarily_unavailable"
]);

export const authRouterContract = {
    authorize: contract("GET", "/auth/authorize")
        .route({
            successStatus: 307,
            inputStructure: "detailed",
            outputStructure: "detailed",
            summary: `
                Initiates the regular OAuth2 flow for Lapse authentication, possibly asking the user to log in via Hackatime, and, for non-canonical
                (third-party) clients, asking for consent.

                **This is a user-agent endpoint.** Clients are expected to open it in a browser (or browser-equivalent) environment - that is,
                it will redirect the user to a user-facing HTML/CSS/JS webpage. It should NOT be queried directly.
            `
        })
        .input(z.object({
            query: z.object({
                // This is not in our usual naming convention, as we're following OAuth's spec.
                response_type: z.literal("code"),
                client_id: z.string(),
                redirect_uri: z.url(),
                scope: z.string(),
                state: z.string(),
                code_challenge: z.string(),
                code_challenge_method: z.literal("S256") // we don't allow plain!
            })
        })),

    grantConsent: contract("POST", "/auth/grantConsent")
        .route({ summary: "Generates a token that represents approved consent to a pending OAuth2 request. **This can only be called when authenticated with the `elevated` scope, which is only available to the canonical app.**" })
        .input(z.object({
            clientId: z.string()
                .describe("The client ID to issue the consent token for."),

            state: z.string()
                .describe("The state variable, to prevent CSRF attacks."),

            scopes: z.string().array()
                .describe("The scopes to grant access to.")
        }))
        .output(z.object({
            token: z.base64url()
                .describe("The token that should be passed to /auth/continue in order to continue the OAuth2 authorization flow.")
        })),

    token: contract("POST", "/auth/token")
        .route({
            summary: "Exchanges an authorization code for an access token.",
            inputStructure: "detailed",
            outputStructure: "detailed"
        })
        .input(z.object({
            // We expect this to be application/x-www-form-urlencode - oRPC should handle that here:
            //      https://github.com/middleapi/orpc/blob/819ed2e0897b18a5d6a4ca85ba68568f055004a1/packages/openapi-client/src/adapters/standard/openapi-serializer.ts#L72-L74
            body: z.object({
                grant_type: z.literal("authorization_code"),
                code: z.string(),
                redirect_uri: z.url(),
                client_id: z.string().optional(),
                code_verifier: z.string().optional()
            })
        }))
        .output(z.object({
            access_token: z.jwt(),
            token_type: z.literal("Bearer"),
            expires_in: z.number(),
            refresh_token: z.string().optional(),
            scope: z.string().optional()
        }))
};
