import { OpenAPIGenerator, type OpenAPI } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { isLazy, isProcedure, type AnyRouter } from "@orpc/server";
import { getScopeDescriptions, ROUTER_TAGS } from "@hackclub/lapse-api";

import { env } from "@/env.js";

// Scalar doesn't support icons on tags, so we prefix each tag's display name with an emoji instead.
const API_TAGS = [
    { name: ROUTER_TAGS.timelapse, icon: "🎬", description: "Query, publish, and manage published timelapses." },
    { name: ROUTER_TAGS.draftTimelapse, icon: "📝", description: "Encrypted, unpublished recordings synchronized between a user's devices." },
    { name: ROUTER_TAGS.comment, icon: "💬", description: "Comments left on published timelapses." },
    { name: ROUTER_TAGS.user, icon: "👤", description: "User profiles, devices, and key relays." },
    { name: ROUTER_TAGS.global, icon: "🌍", description: "Site-wide data, such as leaderboards and recent timelapses." },
    { name: ROUTER_TAGS.hackatime, icon: "⏱️", description: "Linking timelapses with Hackatime projects." },
    { name: ROUTER_TAGS.developer, icon: "🧩", description: "Third-party OAuth apps registered with Lapse." },
    { name: ROUTER_TAGS.auth, icon: "🔑", description: "OAuth authorization and token exchange." },
    { name: ROUTER_TAGS.admin, icon: "🛡️", description: "Administrative endpoints. Require an administrator account." },
];

const API_TAG_GROUPS = [
    { name: "Timelapses", tags: [ROUTER_TAGS.timelapse, ROUTER_TAGS.draftTimelapse, ROUTER_TAGS.comment] },
    { name: "Community", tags: [ROUTER_TAGS.user, ROUTER_TAGS.global] },
    { name: "Integrations", tags: [ROUTER_TAGS.hackatime, ROUTER_TAGS.developer, ROUTER_TAGS.auth] },
    { name: "Administration", tags: [ROUTER_TAGS.admin] },
];

const generator = new OpenAPIGenerator({
    schemaConverters: [
        new ZodToJsonSchemaConverter()
    ]
});

/**
 * Rebuilds `router` from plain objects. Routers created via `implement` expose their contract to the generator instead of
 * their procedures, which would hide the OpenAPI overrides of the middlewares applied to them.
 */
function withoutHiddenContracts(router: AnyRouter): AnyRouter {
    if (isProcedure(router))
        return router;

    return Object.fromEntries(
        Object.entries(router).map(([key, value]) => [key, isLazy(value) ? value : withoutHiddenContracts(value)])
    );
}

/**
 * Generates the OpenAPI document for `router`. The security requirements of each operation are derived from the auth
 * middlewares in `@/router.js` - operations without them can be called anonymously, but may return more data when authenticated.
 */
export async function generateOpenApiSpec(router: AnyRouter): Promise<OpenAPI.Document & { "x-tagGroups": typeof API_TAG_GROUPS }> {
    const spec = await generator.generate(withoutHiddenContracts(router), {
        info: {
            title: "Lapse API",
            version: "2.0.0"
        },
        servers: [
            { url: process.env["NODE_ENV"] === "production" ? `${env.BASE_URL}/api` : "/api" }
        ],
        security: [
            {},
            { oauth2: [] },
            { programKey: [] }
        ],
        tags: API_TAGS.map(tag => ({
            name: tag.name,
            description: tag.description,
            "x-displayName": `${tag.icon} ${tag.name}`
        })),
        components: {
            securitySchemes: {
                oauth2: {
                    type: "oauth2",
                    description: "An access token issued to an OAuth app on behalf of a user. See `docs/authentication.md` for details.",
                    flows: {
                        authorizationCode: {
                            authorizationUrl: `${env.BASE_URL}/api/auth/authorize`,
                            tokenUrl: `${env.BASE_URL}/api/auth/token`,
                            scopes: {
                                ...getScopeDescriptions(),
                                elevated: "Full access, including OAuth app management and admin features. Only granted to the canonical Lapse client."
                            }
                        }
                    }
                },
                programKey: {
                    type: "http",
                    scheme: "bearer",
                    description: "A program key (prefixed with `pk_lapse_`) issued by a Lapse administrator. Program keys aren't associated with a user."
                }
            }
        }
    });

    return { ...spec, "x-tagGroups": API_TAG_GROUPS };
}
