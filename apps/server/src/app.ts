import Fastify from "fastify"
import { onError, os } from "@orpc/server"
import { OpenAPIHandler } from "@orpc/openapi/fastify"
import { ResponseHeadersPlugin } from "@orpc/server/plugins"
import chalk from "chalk"
import * as dotenv from "dotenv";

import { getAuthenticatedUser } from "@/auth.js"
import { apiErr } from "@/common.js"
import type { Context } from "@/router.js"

import user from "@/routers/user.js"
import timelapse from "@/routers/timelapse.js"
import draftTimelapse from "@/routers/draftTimelapse.js"
import comment from "@/routers/comment.js"
import developer from "@/routers/developer.js"
import global from "@/routers/global.js"
import hackatime from "@/routers/hackatime.js"

dotenv.config();

const handler = new OpenAPIHandler(
    os.$context<Context>().router({
        user,
        timelapse,
        comment,
        developer,
        global,
        hackatime,
        draftTimelapse
    }),
    {
        interceptors: [
            onError(err => {
                console.error(err);
            })
        ],
        plugins: [
            new ResponseHeadersPlugin()
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
    const user = await getAuthenticatedUser(req);

    const { matched } = await handler.handle(req, reply, {
        prefix: "/api",
        context: { req, user }
    });

    if (!matched) {
        reply.status(404).send(JSON.stringify(apiErr("NOT_FOUND", "No API route found")));
    }
});

fastify.listen({ port: 3000 })
    .then(address => {
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
                x == 0 ? " " :
                x == 1 ? `${chalk.bgHex("#f97b40")}` :
                x == 2 ? `${chalk.bgHex("#f66a43")}` :
                x == 3 ? `${chalk.bgHex("#ffffff")}` :
                x == 4 ? `${chalk.bgHex("#f04b4c")}` :
                x == 5 ? `${chalk.bgHex("#ed394e")}` :
                "\n"
            ))
            .join("")
            .split("\n");

        logo[3] += `${chalk.reset()}  ⧗ Lapse Server v2.0.0`;
        logo[4] += `${chalk.reset()}  > local: ${address}`;

        console.log(logo.join("\n"));
    });
