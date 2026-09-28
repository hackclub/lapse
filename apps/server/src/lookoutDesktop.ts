import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { lapseId } from "@/common.js";
import { database } from "@/db.js";
import { env } from "@/env.js";
import { logError, logInfo } from "@/logging.js";
import * as lookout from "@/lookout.js";
import { getAuthenticatedUser } from "@/oauth.js";

import {
    allowStart,
    consentPageUrl,
    isExchangeBody,
    PAIRING_CODE_TTL_MS,
    readPairingQuery,
} from "@/lookoutDesktopPolicy.js";

/**
 * Lookout desktop instant start.
 *
 * Registered in Lookout as
 *   pairUrl  https://api.lapse.hackclub.com/lookout/pair
 *   startUrl https://api.lapse.hackclub.com/lookout/start
 *
 * GET  /lookout/pair              redirect the browser to the website consent page
 * POST /lookout/pair/accept       logged-in user mints a one-time code
 * POST /lookout/pair              desktop exchanges {code, verifier} for a device token
 * DELETE /lookout/pair            desktop revokes its own device token
 * GET  /lookout/devices           logged-in user lists linked desktops
 * DELETE /lookout/devices/:id     logged-in user revokes one
 * POST /lookout/start             desktop mints a Lookout session for its user
 *
 * The device token is stored as a SHA-256 hash. It authorizes nothing except
 * creating a Lookout recording session for that user.
 */

const startsByDevice = new Map<string, number[]>();

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("base64url");
}

function bearer(req: FastifyRequest): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
        return null;
    const token = header.slice("Bearer ".length).trim();
    return token || null;
}

async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<{ id: string; handle: string } | null> {
    const actor = await getAuthenticatedUser(req);
    if (!actor || actor.kind !== "USER") {
        reply.code(401).send({ error: "Sign in to Lapse first" });
        return null;
    }
    if (!actor.scopes.includes("elevated") && !actor.scopes.includes("timelapse:write")) {
        reply.code(403).send({ error: "This account cannot start Lookout recordings" });
        return null;
    }
    return { id: actor.user.id, handle: actor.user.handle };
}

export function registerLookoutDesktopRoutes(server: FastifyInstance): void {
    server.get("/lookout/pair", async (request, reply) => {
        const query = readPairingQuery(request.query as Record<string, unknown>);
        if (!query)
            return reply.code(400).send({ error: "invalid pairing request" });
        return reply.redirect(consentPageUrl(env.WEB_BASE_URL, query));
    });

    server.post("/lookout/pair/accept", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;

        const body = request.body as { challenge?: unknown; state?: unknown; device?: unknown } | null;
        const query = readPairingQuery({
            challenge: body?.challenge,
            state: body?.state,
            device: body?.device,
        });
        if (!query)
            return reply.code(400).send({ error: "invalid pairing request" });

        const code = randomBytes(32).toString("base64url");
        await database().lookoutPairingCode.create({
            data: {
                code,
                challenge: query.challenge,
                device: query.device,
                expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
                ownerId: user.id,
            },
        });
        logInfo(`Issued a Lookout desktop pairing code for user ${user.id}`);
        return reply.send({ code });
    });

    server.post("/lookout/pair", async (request, reply) => {
        if (!isExchangeBody(request.body))
            return reply.code(400).send({ error: "invalid code" });

        const { code, verifier } = request.body;
        const burned = await database().lookoutPairingCode.updateMany({
            where: {
                code,
                usedAt: null,
                expiresAt: { gt: new Date() },
                challenge: sha256(verifier),
            },
            data: { usedAt: new Date() },
        });
        if (burned.count !== 1)
            return reply.code(400).send({ error: "invalid code" });

        const row = await database().lookoutPairingCode.findUnique({ where: { code } });
        if (!row)
            return reply.code(400).send({ error: "invalid code" });

        const deviceToken = randomBytes(32).toString("base64url");
        const device = await database().lookoutDesktopDevice.create({
            data: {
                tokenHash: sha256(deviceToken),
                label: row.device,
                ownerId: row.ownerId,
            },
        });
        logInfo(`Linked Lookout desktop ${device.id} for user ${row.ownerId}`);
        return reply.send({ deviceToken });
    });

    server.delete("/lookout/pair", async (request, reply) => {
        const token = bearer(request);
        if (!token)
            return reply.code(401).send({ error: "unknown device" });

        const revoked = await database().lookoutDesktopDevice.updateMany({
            where: { tokenHash: sha256(token), revokedAt: null },
            data: { revokedAt: new Date() },
        });
        if (revoked.count !== 1)
            return reply.code(401).send({ error: "unknown device" });
        return reply.code(204).send();
    });

    server.get("/lookout/devices", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;

        const devices = await database().lookoutDesktopDevice.findMany({
            where: { ownerId: user.id, revokedAt: null },
            orderBy: { createdAt: "desc" },
            select: { id: true, label: true, createdAt: true },
        });
        return reply.send({ devices });
    });

    server.delete<{ Params: { id: string } }>("/lookout/devices/:id", async (request, reply) => {
        const user = await requireUser(request, reply);
        if (!user)
            return;
        if (!/^[A-Za-z0-9_-]{8,32}$/.test(request.params.id))
            return reply.code(404).send({ error: "unknown device" });

        const revoked = await database().lookoutDesktopDevice.updateMany({
            where: { id: request.params.id, ownerId: user.id, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        if (revoked.count !== 1)
            return reply.code(404).send({ error: "unknown device" });
        return reply.code(204).send();
    });

    server.post("/lookout/start", async (request, reply) => {
        const token = bearer(request);
        if (!token)
            return reply.code(401).send({ error: "unknown device" });

        const device = await database().lookoutDesktopDevice.findFirst({
            where: { tokenHash: sha256(token), revokedAt: null },
            include: { owner: true },
        });
        if (!device)
            return reply.code(401).send({ error: "unknown device" });

        const recent = startsByDevice.get(device.id) ?? [];
        if (!allowStart(recent, Date.now())) {
            startsByDevice.set(device.id, recent);
            return reply.code(429).send({ error: "too many sessions" });
        }
        startsByDevice.set(device.id, recent);

        try {
            const sessionToken = await mintSession(device.owner.id, device.owner.handle);
            return reply.send({ sessionToken });
        }
        catch (err) {
            logError("Lookout desktop start failed", { err, userId: device.owner.id });
            return reply.code(502).send({ error: "could not start a session" });
        }
    });
}

/**
 * The same session the website's "Open Lookout" button creates: a draft
 * owned by this user, and a Lookout session that sends them back to the
 * handoff page when the timelapse compiles.
 */
async function mintSession(userId: string, handle: string): Promise<string> {
    const draftId = lapseId();
    const session = await lookout.createSession(undefined, {
        lapseUserId: userId,
        lapseUserHandle: handle,
        source: "lapse",
    }, {
        clips: true,
        redirectUrl: `${env.WEB_BASE_URL}/timelapse/handoff/${draftId}`,
    });

    await database().draftLookoutTimelapse.create({
        data: {
            id: draftId,
            lookoutSessionId: session.sessionId,
            lookoutToken: session.token,
            ownerId: userId,
        },
    });
    logInfo(`Started Lookout desktop session ${session.sessionId} for user ${userId}`);
    return session.token;
}
