import "@/server/allow-only-server";

import { REST_PROCEDURES } from "@/server/rest";
import { getScopeDescriptions } from "@/shared/oauthScopes";

const REST_BASE_PATH = "/api/rest";

function toOperationId(router: string, procedure: string) {
  return `${router}.${procedure}`;
}

function buildPaths() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const [router, procedures] of Object.entries(REST_PROCEDURES)) {
    for (const [procedure, config] of Object.entries(procedures)) {
      const path = `${REST_BASE_PATH}/${router}/${procedure}`;
      const method = config.method.toLowerCase();

      const parameters =
        config.method === "GET"
          ? [
              {
                name: "input",
                in: "query",
                required: false,
                schema: { type: "string" },
                description: "JSON-encoded input object (tRPC-compatible).",
              },
            ]
          : [];

      const requestBody =
        config.method === "GET"
          ? undefined
          : {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            };

      const security = config.requiresAuth
        ? config.scopes.length > 0
          ? [{ oauth2: config.scopes }]
          : [{ bearerAuth: [] }]
        : undefined;

      const operation: Record<string, unknown> = {
        operationId: toOperationId(router, procedure),
        summary: config.summary,
        tags: [router],
        responses: {
          "200": {
            description: "Successful response",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
          "400": {
            description: "Bad request",
          },
          "401": {
            description: "Unauthorized",
          },
          "403": {
            description: "Forbidden",
          },
          "500": {
            description: "Server error",
          },
        },
      };

      if (parameters.length > 0) operation.parameters = parameters;

      if (requestBody) operation.requestBody = requestBody;

      if (security) operation.security = security;

      if (!paths[path]) paths[path] = {};

      paths[path][method] = operation;
    }
  }

  return paths;
}

export function buildRestOpenApiSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Lapse REST API",
      version: "1.0.0",
      description: "The official lapse REST API!",
    },
    tags: Object.keys(REST_PROCEDURES).map((name) => ({ name })),
    paths: {
      "/api/oauth/token": {
        post: {
          operationId: "oauth.token",
          summary: "OAuth2 token exchange (RFC 8693)",
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
      ...buildPaths(),
    },
  };
}
