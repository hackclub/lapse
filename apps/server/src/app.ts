import "dotenv/config";

import Fastify from "fastify"
import { implement, onError, os } from "@orpc/server"
import { OpenAPIHandler } from "@orpc/openapi/fastify"
import { RequestHeadersPlugin, ResponseHeadersPlugin } from "@orpc/server/plugins"
import chalk from "chalk"
import { compositeRouterContract } from "@hackclub/lapse-api";

import { getAuthenticatedUser } from "@/oauth.js"
import { apiErr } from "@/common.js"
import type { Context } from "@/router.js"
import { initDatabase, initRedis } from "@/db.js";
import { env } from "@/env.js"

import user from "@/routers/user.js"
import timelapse from "@/routers/timelapse.js"
import draftTimelapse from "@/routers/draftTimelapse.js"
import comment from "@/routers/comment.js"
import developer from "@/routers/developer.js"
import global from "@/routers/global.js"
import hackatime from "@/routers/hackatime.js"
import auth from "@/routers/auth.js"

const handler = new OpenAPIHandler(
    implement(compositeRouterContract)
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
        }),
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

const fastify = Fastify();

fastify.addContentTypeParser("*", (request, payload, done) => {
  // Fully utilize oRPC feature by allowing any content type
  // And let oRPC parse the body manually by passing `undefined`
  done(null, undefined);
});

fastify.all("/api/*", async (req, reply) => {
    const { user, scopes } = await getAuthenticatedUser(req);

    const { matched } = await handler.handle(req, reply, {
        prefix: "/api",
        context: { req, user, scopes }
    });

    if (!matched) {
        reply.status(404).send(JSON.stringify(apiErr("NOT_FOUND", "No API route found")));
    }
});

fastify.listen({ port: parseInt(env.PORT) })
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
