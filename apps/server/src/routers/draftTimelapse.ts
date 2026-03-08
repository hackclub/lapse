import { z } from "zod";
import { implement } from "@orpc/server";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { oneOf, range, toHex } from "@hackclub/lapse-shared";

import * as db from "@/generated/prisma/client.js";
import { draftTimelapseRouterContract, EditListEntrySchema, MAX_THUMBNAIL_UPLOAD_SIZE, MAX_VIDEO_UPLOAD_SIZE, type DraftTimelapse } from "@hackclub/lapse-api";
import { logMiddleware, requiredAuth, requiredScopes, type Context } from "@/router.js";
import { env } from "@/env.js";
import { database } from "@/db.js";

import { apiOk, apiErr, lapseId, Err } from "@/common.js";
import { logInfo } from "@/logging.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { actorEntitledTo, stringifyActor, type Actor } from "@/ownership.js";
import { dtoPublicUser } from "@/routers/user.js";
import { issueUploadToken } from "@/upload.js";

const s3 = new S3Client({
    region: "auto",
    endpoint: env.S3_ENDPOINT,
    credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
});

const os = implement(draftTimelapseRouterContract)
    .$context<Context>()
    .use(logMiddleware);

export function dtoDraftTimelapse(entity: db.DraftTimelapse & { owner: db.User }): DraftTimelapse {
    return {
        id: entity.id,
        createdAt: entity.createdAt.getTime(),
        description: entity.description,
        name: entity.name ?? undefined,
        editList: entity.editList.map(x => EditListEntrySchema.parse(x)),
        sessions: entity.sessions.map(x => `${env.S3_PUBLIC_URL_ENCRYPTED}/${x}`),
        previewThumbnail: `${env.S3_PUBLIC_URL_ENCRYPTED}/${entity.thumbnailKey}`,
        deviceId: entity.deviceId,
        owner: dtoPublicUser(entity.owner),
        isDraft: true,
        iv: entity.iv
    };
}

/**
 * Deletes a draft timelapse alongside all of its associated S3 resources. Does *not* delete any other database object.
 */
export async function deleteDraftTimelapse(id: string, actor: Actor): Promise<Err | void> {
    logInfo(`Deleting draft timelapse ${id} (action triggered by ${stringifyActor(actor)})`);
    const draft = await database().draftTimelapse.findFirst({
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

    await database().draftTimelapse.delete({
        where: { id }
    });

    logInfo(`Draft timelapse ${id} deleted.`);
}

export default os.router({
    query: os.query
        .use(requiredAuth())
        .use(requiredScopes("timelapse:read"))
        .handler(async (req) => {
            const caller = req.context.user;

            const draft = await database().draftTimelapse.findFirst({
                include: { owner: true },
                where: { id: req.input.id }
            });

            if (!draft || !actorEntitledTo(draft, caller))
                return apiErr("NOT_FOUND", "The requested draft timelapse doesn't exist.");

            return apiOk({ timelapse: dtoDraftTimelapse(draft) });
        }),

    findByUser: os.findByUser
        .use(requiredAuth())
        .use(requiredScopes("timelapse:read"))
        .handler(async (req) => {
            const caller = req.context.user;

            if (caller.id != req.input.user && !(caller.permissionLevel in oneOf("ADMIN", "ROOT")))
                return apiErr("NO_PERMISSION", "You may only query draft timelapses for yourself.");

            const drafts = await database().draftTimelapse.findMany({
                include: { owner: true },
                where: { ownerId: req.context.user.id }
            });

            return apiOk({ timelapses: drafts.map(x => dtoDraftTimelapse(x)) });
        }),

    create: os.create
        .use(requiredAuth())
        .use(requiredScopes("timelapse:write"))
        .handler(async (req) => {
            const caller = req.context.user;
            const id = lapseId();

            const totalSize = req.input.sessions.map(x => x.fileSize).reduce((x, y) => x + y);
            if (totalSize > MAX_VIDEO_UPLOAD_SIZE)
                return apiErr("SIZE_LIMIT", `The total of the session file sizes (${totalSize} bytes) exceeds the maximum (${MAX_VIDEO_UPLOAD_SIZE} bytes).`);

            // We use pre-signed S3 URLs for the session upload URLs.
            const sessionKeys = range(req.input.sessions.length).map(i => `timelapses/${caller.id}/${id}-session${i}.webm`);
            const sessionTokens = req.input.sessions.map((x, i) => issueUploadToken(sessionKeys[i], x.fileSize));

            const device = await database().knownDevice.findFirst({
                where: {
                    id: req.input.deviceId,
                    ownerId: caller.id
                }
            });

            if (!device)
                return apiErr("DEVICE_NOT_FOUND", `The specified known device ${req.input.deviceId} could not be found.`);

            const thumbnailKey = `timelapses/${caller.id}/${id}-thumbnail.webp`;
            const thumbnailUploadToken = issueUploadToken(thumbnailKey, MAX_THUMBNAIL_UPLOAD_SIZE);

            const iv = new Uint8Array(128 / 8);
            crypto.getRandomValues(iv);

            const draft = await database().draftTimelapse.create({
                include: { owner: true },
                data: {
                    id,
                    name: req.input.name,
                    description: req.input.description,
                    editList: [],
                    sessions: sessionKeys,
                    thumbnailKey,
                    snapshots: req.input.snapshots.map(x => new Date(x)),
                    deviceId: req.input.deviceId,
                    ownerId: caller.id,
                    iv: toHex(iv)
                }
            });

            return apiOk({
                sessionUploadTokens: sessionTokens,
                thumbnailUploadToken,
                draftTimelapse: dtoDraftTimelapse(draft)
            });
        }),

    update: os.update
        .use(requiredAuth())
        .use(requiredScopes("timelapse:write"))
        .handler(async (req) => {
            const caller = req.context.user;

            const draft = await database().draftTimelapse.findFirst({
                where: { id: req.input.id },
            });

            if (!draft)
                return apiErr("NOT_FOUND", "Couldn't find that draft timelapse!");

            const canEdit =
                caller.id === draft.ownerId ||
                caller.permissionLevel in oneOf("ADMIN", "ROOT");

            if (!canEdit)
                return apiErr("NO_PERMISSION", "You don't have permission to edit this draft timelapse!");

            const updated = await database().draftTimelapse.update({
                include: { owner: true },
                where: { id: req.input.id },
                data: req.input.changes
            });

            return apiOk({ timelapse: dtoDraftTimelapse(updated) });
        }),

    delete: os.delete
        .use(requiredAuth())
        .use(requiredScopes("timelapse:write"))
        .handler(async (req) => {
            const caller = req.context.user;

            const res = await deleteDraftTimelapse(req.input.id, caller);
            if (res instanceof Err)
                return res.toApiError();

            return apiOk({});
        })
});
