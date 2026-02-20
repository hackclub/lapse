import Fastify from "fastify"
import { onError, os } from "@orpc/server"
import { OpenAPIHandler } from "@orpc/openapi/fastify"
import { ResponseHeadersPlugin } from "@orpc/server/plugins"

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
    .then(() => console.log("Server running on http://localhost:3000"));
