import type { AdminEntity } from "@hackclub/lapse-api";
import { database } from "@/db.js";

export type AuditValue = string | number | boolean | null;
export type AuditChanges = Record<string, { from: AuditValue; to: AuditValue }>;

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

export async function findAuditedEntity(entity: AdminEntity, id: string): Promise<Record<string, unknown> | null> {
    switch (entity) {
        case "user":
            return await database().user.findUnique({ where: { id } });
        case "timelapse":
            return await database().timelapse.findUnique({ where: { id } });
        case "comment":
            return await database().comment.findUnique({ where: { id } });
        case "draftTimelapse":
            return await database().draftTimelapse.findUnique({ where: { id } });
        case "legacyTimelapse":
            return await database().legacyUnpublishedTimelapse.findUnique({ where: { id } });
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

export async function recordAdminChange(actorId: string | null, entity: AdminEntity, entityId: string, changes: AuditChanges) {
    const fields = Object.keys(changes);
    if (fields.length === 0)
        return;

    await database().adminAuditLog.create({
        data: { actorId, entity, entityId, fields, changes }
    });
}
