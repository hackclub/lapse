import "dotenv/config";

import Fastify from "fastify"
import { implement, onError } from "@orpc/server"
import { OpenAPIHandler } from "@orpc/openapi/fastify"
import { OpenAPIGenerator } from "@orpc/openapi";
import { RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins"
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import chalk from "chalk";
import dedent from "dedent";
import { compositeRouterContract } from "@hackclub/lapse-api";

import { getAuthenticatedUser } from "@/oauth.js"
import { apiErr } from "@/common.js"
import type { Context } from "@/router.js"
import { database, initDatabase, initRedis } from "@/db.js";
import { env } from "@/env.js"

import user from "@/routers/user.js"
import timelapse from "@/routers/timelapse.js"
import draftTimelapse from "@/routers/draftTimelapse.js"
import comment from "@/routers/comment.js"
import developer from "@/routers/developer.js"
import global from "@/routers/global.js"
import hackatime from "@/routers/hackatime.js"
import auth from "@/routers/auth.js"
import { logError } from "@/logging.js";
import { attachUploadServer } from "@/upload.js";

const router = implement(compositeRouterContract)
    .$context<Context>()
    .router({
        user,
        timelapse,
        draftTimelapse,
        comment,
        developer,
        global,
        hackatime,
        auth
    });

const handler = new OpenAPIHandler(
    router,
    {
        interceptors: [
            onError(err => {
                console.error(err);
            })
        ],
        plugins: [
            new ResponseHeadersPlugin(),
            new RequestHeadersPlugin<Context>(),
        ]
    }
);

const openApiGenerator = new OpenAPIGenerator({
    schemaConverters: [
        new ZodToJsonSchemaConverter()
    ]
});

const server = Fastify();

server.addContentTypeParser("*", (request, payload, done) => {
  // Fully utilize oRPC feature by allowing any content type
  // And let oRPC parse the body manually by passing `undefined`
  done(null, undefined);
});

server.all("/api/*", async (req, reply) => {
    const { user, scopes } = await getAuthenticatedUser(req);

    if (req.url === "/health") {
        try {
            database().user.findFirst();
        }
        catch (err) {
            logError("Health check failed - couldn't query the database!", { err });
            reply.status(500).send("NO_DATABASE");
            return;
        }

        reply.status(200).send("OK");
    }

    const { matched } = await handler.handle(req, reply, {
        prefix: "/api",
        context: { req, user, scopes }
    });

    if (!matched) {
        // No API route matched - but the user might be accessing either the OpenAPI spec or the
        // Scalar frontend.
        if (req.url == "/openapi.json") {
            const spec = await openApiGenerator.generate(router, {
                info: {
                    title: "Lapse API",
                    version: "2.0.0"
                },
                servers: [
                    { url: process.env["NODE_ENV"] === "production" ? `${env.BASE_URL}/api` : "/api" }
                ],
                security: [
                    { bearerAuth: [] }
                ],
                components: {
                    securitySchemes: {
                        bearerAuth: {
                            type: "http",
                            scheme: "bearer"
                        }
                    }
                }
            });

            reply.status(200).header("content-type", "application/json").send(JSON.stringify(spec));
            return;
        }

        if (req.url === "/docs") {
            reply.status(200).header("content-type", "text/html").send(
                dedent/*html*/`
                <!doctype html>
                <html>
                    <head>
                        <title>Lapse API Docs</title>
                        <meta charset="utf-8" />
                        <meta name="viewport" content="width=device-width, initial-scale=1" />
                    </head>
                    <body>
                        <div id="app"></div>

                        <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
                        <script>
                            Scalar.createApiReference("#app", {
                                url: "/openapi.json",
                                authentication: {
                                    securitySchemes: {
                                        bearerAuth: { token: "default-token" }
                                    }
                                }
                            });
                        </script>
                    </body>
                </html>
                `
            );

            return;
        }

        reply.status(404).send(JSON.stringify(apiErr("NOT_FOUND", "No API route found")));
    }
});

attachUploadServer(server);

server.listen({ port: parseInt(env.PORT) })
    .then(address => {
        if (process.env["NODE_ENV"] === "development") {
            chalk.level = 3;

            const logo = [
                0, 1, 1, 1, 1, 2, 2, 0, -1,
                1, 1, 3, 3, 3, 3, 4, 4, -1,
                1, 1, 3, 3, 3, 3, 4, 4, -1,
                1, 1, 2, 3, 3, 4, 4, 4, -1,
                1, 1, 2, 3, 3, 4, 4, 5, -1,
                1, 2, 3, 3, 3, 3, 5, 5, -1,
                2, 2, 3, 3, 3, 3, 5, 5, -1,
                0, 4, 4, 4, 5, 5, 5, 0
            ]
                .map(x => (
                    x == 0 ? "  " :
                    x == 1 ? `${chalk.bgHex("#f97b40")("  ")}` :
                    x == 2 ? `${chalk.bgHex("#f66a43")("  ")}` :
                    x == 3 ? `${chalk.bgHex("#ffffff")("  ")}` :
                    x == 4 ? `${chalk.bgHex("#f04b4c")("  ")}` :
                    x == 5 ? `${chalk.bgHex("#ed394e")("  ")}` :
                    "\n"
                ))
                .join("")
                .split("\n");

            logo[2] += `${chalk.reset()}   ${chalk.hex("#f66a43")("⧗ Lapse Server v2.0.0")}`;
            logo[3] += `${chalk.reset()}   > ${chalk.bold("local")}: ${address}`;
            logo[4] += `${chalk.reset()}   > ${chalk.bold("connected to Redis")}: ${env.REDIS_URL.substring(0, 32)}...`;
            logo[5] += `${chalk.reset()}   > ${chalk.bold("connected to database")}: ${env.DATABASE_URL.substring(0, 32)}...`;

            console.log(" \n ");
            console.log(logo.join("\n"));
            console.log(" \n ");
        }
        else {
            // We don't need anything flashy for production environments
            console.log("⧗ Lapse Server v2.0.0");
        }

        initDatabase();
        initRedis();
    });
