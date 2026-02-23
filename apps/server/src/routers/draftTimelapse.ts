import { z } from "zod";
import { implement } from "@orpc/server";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { oneOf } from "@hackclub/lapse-shared";

import * as db from "@/generated/prisma/client.js";
import { draftTimelapseRouterContract, EditListEntrySchema, type DraftTimelapse } from "@hackclub/lapse-api";
import { logMiddleware, requiredAuth, type Context } from "@/router.js";
import { env } from "@/env.js";
import { database } from "@/db.js";

import { apiOk, apiErr, lapseId, Err } from "@/common.js";
import { logInfo } from "@/logging.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { actorEntitledTo, type Actor } from "@/ownership.js";

const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.S3_ENDPOINT}`,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

const os = implement(draftTimelapseRouterContract)
    .$context<Context>()
    .use(logMiddleware);

export function dtoDraftTimelapse(entity: db.DraftTimelapse): DraftTimelapse {
    return {
        id: entity.id,
        createdAt: entity.createdAt.getTime(),
        description: entity.description,
        name: entity.name,
        editList: entity.editList.map(x => EditListEntrySchema.parse(x)),
        sessions: entity.sessions.map(x => `${env.S3_PUBLIC_URL_ENCRYPTED}/${x}`)
    };
}

/**
 * Deletes a draft timelapse alongside all of its associated S3 resources. Does *not* delete any other database object.
 */
export async function deleteDraftTimelapse(id: string, actor: Actor): Promise<Err | void> {
    const draft = await database.draftTimelapse.findFirst({
        where: { id }
    });

    if (!draft)
        return new Err("NOT_FOUND", "Couldn't find that timelapse!");

    if (!actorEntitledTo(draft, actor))
        return new Err("NO_PERMISSION", "You don't have permission to delete this timelapse");

    // As the deletion of the draft is explicit (as opposed to implicit, which happens when we convert a draft to a published timelapse),
    // we can safely remove the S3 resources associated with it.
    for (const session of draft.sessions) {
        logInfo(`Deleting session ${session} from S3.`);

        await s3.send(new DeleteObjectCommand({
            Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
            Key: session
        }));
    }

    await database.draftTimelapse.delete({
        where: { id }
    });

    logInfo(`Draft timelapse ${id} deleted.`);
}

export default os.router({
    query: os.query
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            if (caller.id != req.input.user && !(caller.permissionLevel in oneOf("ADMIN", "ROOT")))
                return apiErr("NO_PERMISSION", "You may only query draft timelapses for yourself.");

            const timelapses = await database.draftTimelapse.findMany({
                where: {
                    ownerId: req.context.user.id
                }
            });

            return apiOk({ timelapses: timelapses.map(x => dtoDraftTimelapse(x)) });
        }),

    create: os.create
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;
            const id = lapseId();

            // We use pre-signed S3 URLs for the session upload URLs.
            const sessionKeys = req.input.sessions.map((x, i) => `timelapses/${caller.id}/${id}-session${i}.webm`);
            const sessionUrls = await Promise.all(
                req.input.sessions.map((x, i) => getSignedUrl(
                    s3,
                    new PutObjectCommand({
                        Bucket: env.S3_ENCRYPTED_BUCKET_NAME,
                        Key: `timelapses/${caller.id}/${id}-session${i}.webm`,
                        ContentType: "video/webm",
                        ContentLength: x.fileSize
                    }),
                    { expiresIn: 3600 } // one hour
                ))
            );

            const device = await database.knownDevice.findFirst({
                where: {
                    id: req.input.deviceId,
                    ownerId: caller.id
                }
            });

            if (!device)
                return apiErr("DEVICE_NOT_FOUND", `The specified known device ${req.input.deviceId} could not be found.`);

            const draft = await database.draftTimelapse.create({
                data: {
                    id,
                    name: req.input.name,
                    description: req.input.description,
                    editList: [],
                    sessions: sessionKeys,
                    thumbnailBytes: Buffer.from(req.input.thumbnail, "base64"),
                    snapshots: req.input.snapshots.map(x => new Date(x)),
                    deviceId: req.input.deviceId,
                    ownerId: caller.id
                }
            });

            return apiOk({
                sessionUploadUrls: sessionUrls,
                draftTimelapse: dtoDraftTimelapse(draft)
            });
        }),

    update: os.update
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const draft = await database.draftTimelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!draft)
                return apiErr("NOT_FOUND", "Couldn't find that draft timelapse!");

            const canEdit =
                caller.id === draft.ownerId ||
                caller.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canEdit)
                return apiErr("NO_PERMISSION", "You don't have permission to edit this draft timelapse!");

            const updated = await database.draftTimelapse.update({
                where: { id: req.input.id },
                data: req.input.changes
            });

            return apiOk({ timelapse: dtoDraftTimelapse(updated) });
        }),

    delete: os.delete
        .use(requiredAuth())
        .handler(async (req) => {
            const caller = req.context.user;

            const res = await deleteDraftTimelapse(req.input.id, caller);
            if (res instanceof Err)
                return res.toApiError();

            return apiOk({});
        })
});
