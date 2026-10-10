import type { AdminEntity } from "@hackclub/lapse-api";
import { oneOf } from "@hackclub/lapse-shared";

import { database } from "@/db.js";
import type { Actor } from "@/ownership.js";
import type * as db from "@/generated/prisma/client.js";

export type AuditValue = string | number | boolean | null;
export type AuditChanges = Record<string, { from: AuditValue; to: AuditValue }>;
export type AuditClient = db.Prisma.TransactionClient;

/**
 *  tldr new audit logs in case smth
 */

function toAuditValue(value: unknown): AuditValue {
    if (value === null || value === undefined)
        return null;

    if (value instanceof Date)
        return value.toISOString();

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        return value;

    return JSON.stringify(value);
}

export async function findAuditedEntity(tx: AuditClient, entity: AdminEntity, id: string): Promise<Record<string, unknown> | null> {
    switch (entity) {
        case "user":
            return await tx.user.findUnique({ where: { id } });
        case "timelapse":
            return await tx.timelapse.findUnique({ where: { id } });
        case "comment":
            return await tx.comment.findUnique({ where: { id } });
        case "draftTimelapse":
            return await tx.draftTimelapse.findUnique({ where: { id } });
        case "lookoutDraft":
            return await tx.draftLookoutTimelapse.findUnique({ where: { id }, omit: { lookoutToken: true, panelToken: true } });
        case "legacyTimelapse":
            return await tx.legacyUnpublishedTimelapse.findUnique({ where: { id } });
    }
}

export function diffAuditedFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]): AuditChanges {
    const changes: AuditChanges = {};

    for (const field of fields) {
        const from = toAuditValue(before[field]);
        const to = toAuditValue(after[field]);

        if (from !== to) {
            changes[field] = { from, to };
        }
    }

    return changes;
}

/**
 * Returns the ID of `actor` if it's an administrator acting on something owned by somebody else, and `null` otherwise.
 * Used to audit admin actions that go through the regular (non-admin) endpoints.
 */
export function adminOverrideActorId(actor: Actor | null, ownerId: string): string | null {
    if (actor?.kind !== "USER" || actor.user.id === ownerId)
        return null;

    return actor.user.permissionLevel in oneOf("ADMIN", "ROOT") ? actor.user.id : null;
}

export async function recordAdminChange(tx: AuditClient, actorId: string | null, entity: AdminEntity, entityId: string, changes: AuditChanges) {
    const fields = Object.keys(changes);
    if (fields.length === 0)
        return;

    await tx.adminAuditLog.create({
        data: { actorId, entity, entityId, fields, changes }
    });
}

export const DELETION_CHANGE: AuditChanges = { deleted: { from: false, to: true } };

export async function recordAdminDeletion(actorId: string, entity: AdminEntity, entityId: string) {
    await recordAdminChange(database(), actorId, entity, entityId, DELETION_CHANGE);
}
