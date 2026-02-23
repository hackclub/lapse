import "@/server/allow-only-server";

import { generateOpenApiDocument } from "trpc-to-openapi";
import { appRouter } from "@/server/routers/_app";

export function buildRestOpenApiSpec() {
    const generatedDoc = generateOpenApiDocument(appRouter, {
        title: "Lapse REST API",
        version: "1.0.0",
        description: "Provides access to Lapse resources to external services.",
        baseUrl: "/api/rest",
        securitySchemes: {
            bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
            },
            oauth2: {
                type: "oauth2",
                flows: {
                    authorizationCode: {
                        authorizationUrl: "/api/oauth/authorize",
                        tokenUrl: "/api/oauth/token",
                        scopes: {
                            "timelapse:read": "Read timelapses",
                            "timelapse:write": "Create and modify timelapses",
                            "user:read": "Read user data",
                            "user:write": "Modify user data",
                            "snapshot:read": "Read snapshots",
                            "snapshot:write": "Modify snapshots",
                            "comment:read": "Read comments",
                            "comment:write": "Create and delete comments",
                            "global:read": "Read global data",
                        },
                    },
                },
            },
        },
    });

    return {
        ...generatedDoc,
        paths: {
            "/api/oauth/token": {
                post: {
                    operationId: "oauth.token",
                    summary: "OAuth2 authorization code exchange",
                    tags: ["oauth"],
                    requestBody: {
                        required: true,
                        content: {
                            "application/x-www-form-urlencoded": {
                                schema: { type: "object" },
                            },
                        },
                    },
                    responses: {
                        "200": {
                            description: "Token exchange response",
                            content: {
                                "application/json": {
                                    schema: { type: "object" },
                                },
                            },
                        },
                        "400": { description: "Bad request" },
                        "401": { description: "Unauthorized" },
                        "403": { description: "Forbidden" },
                    },
                },
            },
            ...generatedDoc.paths,
        },
    };
}
