import "dotenv/config";
import "@/instrument.js";

import Fastify from "fastify"
import fastifyCors from "@fastify/cors"
import { onError, ORPCError, ValidationError } from "@orpc/server"
import { OpenAPIHandler } from "@orpc/openapi/fastify"
import { RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins"
import chalk from "chalk";
import dedent from "dedent";
import z from "zod";

import { ensureCanonicalClient, getAuthenticatedUser } from "@/oauth.js"
import { apiErr } from "@/common.js"
import type { Context } from "@/router.js"
import { database, initDatabase } from "@/db.js";
import { assertNoExampleSecrets, env } from "@/env.js"
import { logError, logWarning } from "@/logging.js";
import { generateOpenApiSpec } from "@/openapi.js";
// New recordings go through Lookout, but the tus upload server is still needed so legacy drafts
// (and unfinished OPFS recordings) can be recovered and published. See `legacyRecovery` on the client.
import { attachUploadServer } from "@/upload.js";
import { ADMIN_ROUTE_PATHS } from "@/adminKey.js";
import { registerDetectionRoutes } from "@/detections.js";
import { registerUserSearchRoutes } from "@/userSearch.js";
import { registerUserTimelapseRoutes } from "@/userTimelapses.js";
import { registerPrivacyRoutes } from "@/privacy.js";
import { registerLookoutDesktopRoutes } from "@/lookoutDesktop.js";
import { startLookoutPublishSweeper } from "@/lookoutPublish.js";
import { startRecordingClientBackfill } from "@/recordingClientBackfill.js";
import { startAirtableUserSync } from "@/airtableSync.js";

import { router } from "@/appRouter.js";
import { startRealizeJobEvents } from "@/job.js";

const handler = new OpenAPIHandler(
    router,
    {
        interceptors: [
            onError(err => {
                const [message, data] = err instanceof ORPCError && err.cause instanceof ValidationError
                    ? [z.prettifyError(err.cause), { err }]
                    : [`${err}`, { err }];

                // Client mistakes like NOT_FOUND or a bad input are worth a log line, not a Sentry issue.
                if (err instanceof ORPCError && err.status < 500) {
                    logWarning(message, data);
                }
                else {
                    logError(message, data);
                }
            })
        ],
        plugins: [
            new ResponseHeadersPlugin(),
            new RequestHeadersPlugin<Context>(),
        ]
    }
);

assertNoExampleSecrets();

const server = Fastify();

// Open to every origin, credentials included, on purpose. Third-party web apps call the API from their own origins,
// and our SDK's README long told them to send `credentials: "include"` - which browsers refuse to complete unless
// the response allows credentials for that origin. What keeps other origins away from the website's session is not
// this header but `session.ts`: the session cookie is ignored unless the request's `Origin` is the website's.
server.register(fastifyCors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]
});

server.addContentTypeParser("*", (request, payload, done) => {
    if (ADMIN_ROUTE_PATHS.has(request.url)) {
        let body = "";
        payload.setEncoding("utf8");
        payload.on("data", chunk => body += chunk);
        payload.on("end", () => {
            try {
                done(null, JSON.parse(body));
            }
            catch (err) {
                done(err instanceof Error ? err : new Error("Invalid JSON"), undefined);
            }
        });
        return;
    }

    // Fully utilize oRPC feature by allowing any content type
    // And let oRPC parse the body manually by passing `undefined`
    done(null, undefined);
});

registerDetectionRoutes(server);
registerUserSearchRoutes(server);
registerUserTimelapseRoutes(server);

// GDPR deletion and export requests from the Hack Club privacy hub. See `docs/privacy.md`.
registerPrivacyRoutes(server);

// Lookout's desktop app talks to these directly - device pairing, starting a recording without a
// browser, and the publish panel it renders in-app. See `lookoutDesktop.ts`.
registerLookoutDesktopRoutes(server);

// Lookout has no webhook, so a recording whose publish details were filled in before it finished
// compiling needs someone to notice it is ready. See `lookoutPublish.ts`.
startLookoutPublishSweeper();

// Timelapses published before `recordedWith` existed learn it from Lookout. See `recordingClientBackfill.ts`.
startRecordingClientBackfill();

// Legacy drafts are encoded by the worker; this is where we hear that one finished or failed. See `job.ts`.
startRealizeJobEvents();

// Daily per-user stats for Loops. Does nothing unless the AIRTABLE_SYNC_* variables are set.
startAirtableUserSync();

server.all("/api/*", async (req, reply) => {
    const actor = await getAuthenticatedUser(req);
    const user = actor?.kind === "USER" ? actor.user : null;
    const scopes = actor == null ? [] : actor.kind === "USER" ? actor.scopes : actor.programKey.scopes;

    const { matched } = await handler.handle(req, reply, {
        prefix: "/api",
        context: { req, actor, user, scopes }
    });

    if (!matched) {
        reply.status(404).send(JSON.stringify(apiErr("NOT_FOUND", "No API route found")));
    }
});

server.all("/openapi.json", async (req, reply) => {
    const spec = await generateOpenApiSpec(router);
    reply.status(200).header("content-type", "application/json").send(JSON.stringify(spec));
});

server.all("/health", async (req, reply) => {
    try {
        await database().user.findFirst();
    }
    catch (err) {
        logError("Health check failed - couldn't query the database!", { err });
        reply.status(500).send("NO_DATABASE");
        return;
    }

    reply.status(200).send("OK");
});

server.all("/docs", async (req, reply) => {
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

                <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.4" integrity="sha384-28+p9NyLFAl2b71X2XembwoB3f1K1iY0PyATQvkWJJ9k8E3sFW8FeGMbguBzasxv" crossorigin="anonymous"></script>
                <script>
                    Scalar.createApiReference("#app", {
                        url: "/openapi.json",
                        authentication: {
                            preferredSecurityScheme: "oauth2"
                        }
                    });
                </script>
            </body>
        </html>
        `
    );
});

// Required for legacy draft recovery — lets clients upload encrypted sessions for unfinished recordings.
attachUploadServer(server);

server.listen({ port: parseInt(env.PORT), host: env.HOST })
    .then(async (address) => {
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
        await ensureCanonicalClient();
    });
