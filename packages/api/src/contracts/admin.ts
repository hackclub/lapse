import { z } from "zod";

import { apiResult, LapseId, LapseDate, createResultSchema } from "@/common";
import { contract, NO_INPUT } from "@/internal";
import { PermissionLevelSchema } from "@/contracts/user";

export type AdminEntity = z.infer<typeof AdminEntitySchema>;
export const AdminEntitySchema = z.enum(["user", "timelapse", "comment", "draftTimelapse"]);

export type AdminFilterOperator = z.infer<typeof AdminFilterOperatorSchema>;
export const AdminFilterOperatorSchema = z.enum(["eq", "neq", "contains", "gt", "lt", "gte", "lte"]);

export type AdminFilter = z.infer<typeof AdminFilterSchema>;
export const AdminFilterSchema = z.object({
    field: z.string(),
    operator: AdminFilterOperatorSchema,
    value: z.string()
});

export type AdminSort = z.infer<typeof AdminSortSchema>;
export const AdminSortSchema = z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"])
});

export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;
export const AdminUserRowSchema = z.object({
    id: LapseId,
    email: z.string(),
    handle: z.string(),
    displayName: z.string(),
    permissionLevel: PermissionLevelSchema,
    profilePictureUrl: z.string(),
    bio: z.string(),
    hackatimeId: z.string().nullable(),
    slackId: z.string().nullable(),
    createdAt: LapseDate,
    lastHeartbeat: LapseDate
});

export type AdminTimelapseRow = z.infer<typeof AdminTimelapseRowSchema>;
export const AdminTimelapseRowSchema = z.object({
    id: LapseId,
    name: z.string(),
    thumbnailUrl: z.string().nullable(),
    visibility: z.string(),
    duration: z.number(),
    ownerId: LapseId,
    ownerHandle: z.string(),
    hackatimeProject: z.string().nullable(),
    sourceDraftId: z.string().nullable(),
    createdAt: LapseDate,
    associatedJobId: z.string().nullable()
});

export type AdminCommentRow = z.infer<typeof AdminCommentRowSchema>;
export const AdminCommentRowSchema = z.object({
    id: LapseId,
    content: z.string(),
    authorId: LapseId,
    authorHandle: z.string(),
    timelapseId: LapseId,
    createdAt: LapseDate
});

export type AdminDraftTimelapseRow = z.infer<typeof AdminDraftTimelapseRowSchema>;
export const AdminDraftTimelapseRowSchema = z.object({
    id: LapseId,
    name: z.string().nullable(),
    description: z.string(),
    ownerId: LapseId,
    ownerHandle: z.string(),
    deviceId: z.string(),
    associatedTimelapseId: z.string().nullable(),
    createdAt: LapseDate,
    sessionsCount: z.number().int(),
    snapshotsCount: z.number().int()
});

export const ADMIN_ENTITY_FIELDS = {
    user: {
        id: { label: "ID", kind: "string" as const, sortable: true },
        email: { label: "Email", kind: "string" as const, sortable: true, editable: true },
        handle: { label: "Handle", kind: "string" as const, sortable: true, editable: true },
        displayName: { label: "Display Name", kind: "string" as const, sortable: true, editable: true },
        permissionLevel: { label: "Permission Level", kind: "enum" as const, sortable: true, editable: true, enumValues: ["USER", "ADMIN", "ROOT"] },
        profilePictureUrl: { label: "Profile Picture URL", kind: "string" as const },
        bio: { label: "Bio", kind: "string" as const, editable: true },
        hackatimeId: { label: "Hackatime ID", kind: "string" as const, sortable: true },
        slackId: { label: "Slack ID", kind: "string" as const, sortable: true },
        createdAt: { label: "Created At", kind: "date" as const, sortable: true },
        lastHeartbeat: { label: "Last Heartbeat", kind: "date" as const, sortable: true }
    },
    timelapse: {
        id: { label: "ID", kind: "string" as const, sortable: true },
        name: { label: "Name", kind: "string" as const, sortable: true, editable: true },
        visibility: { label: "Visibility", kind: "enum" as const, sortable: true, editable: true, enumValues: ["UNLISTED", "PUBLIC", "FAILED_PROCESSING"] },
        duration: { label: "Duration", kind: "number" as const, sortable: true },
        ownerId: { label: "Owner ID", kind: "string" as const, sortable: true },
        ownerHandle: { label: "Owner Handle", kind: "string" as const, sortable: true },
        hackatimeProject: { label: "Hackatime Project", kind: "string" as const, sortable: true },
        sourceDraftId: { label: "Source Draft ID", kind: "string" as const },
        createdAt: { label: "Created At", kind: "date" as const, sortable: true },
        associatedJobId: { label: "Associated Job ID", kind: "string" as const }
    },
    comment: {
        id: { label: "ID", kind: "string" as const, sortable: true },
        content: { label: "Content", kind: "string" as const, editable: true },
        authorId: { label: "Author ID", kind: "string" as const, sortable: true },
        authorHandle: { label: "Author Handle", kind: "string" as const, sortable: true },
        timelapseId: { label: "Timelapse ID", kind: "string" as const, sortable: true },
        createdAt: { label: "Created At", kind: "date" as const, sortable: true }
    },
    draftTimelapse: {
        id: { label: "ID", kind: "string" as const, sortable: true },
        name: { label: "Name", kind: "string" as const, sortable: true, editable: true },
        description: { label: "Description", kind: "string" as const, editable: true },
        ownerId: { label: "Owner ID", kind: "string" as const, sortable: true },
        ownerHandle: { label: "Owner Handle", kind: "string" as const, sortable: true },
        deviceId: { label: "Device ID", kind: "string" as const, sortable: true },
        associatedTimelapseId: { label: "Associated Timelapse ID", kind: "string" as const },
        createdAt: { label: "Created At", kind: "date" as const, sortable: true },
        sessionsCount: { label: "Sessions Count", kind: "number" as const, sortable: true },
        snapshotsCount: { label: "Snapshots Count", kind: "number" as const, sortable: true }
    }
} as const;

export const AdminListInputSchema = z.object({
    entity: AdminEntitySchema,
    filters: z.array(AdminFilterSchema).default([]),
    sort: AdminSortSchema.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25)
});

export const AdminListResultSchema = z.object({
    entity: AdminEntitySchema,
    rows: z.array(z.record(z.string(), z.unknown())),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1)
});

export const AdminUpdateInputSchema = z.object({
    entity: AdminEntitySchema,
    id: LapseId,
    changes: z.record(z.string(), z.unknown())
});

export const AdminUpdateResultSchema = z.object({
    entity: AdminEntitySchema,
    row: z.record(z.string(), z.unknown())
});

export type AdminSearchResult = z.infer<typeof AdminSearchResultSchema>;
export const AdminSearchResultSchema = z.object({
    entity: AdminEntitySchema,
    id: LapseId,
    displayText: z.string()
});

export const AdminSearchInputSchema = z.object({
    query: z.string().min(1)
});

export const AdminSearchOutputSchema = z.object({
    results: z.array(AdminSearchResultSchema)
});

export const adminRouterContract = {
    stats: contract("GET", "/admin/stats")
        .route({ description: "Returns aggregate statistics for the admin dashboard. Requires administrator permissions and an `elevated` grant." })
        .input(NO_INPUT)
        .output(apiResult({
            totalLoggedSeconds: z.number().nonnegative(),
            totalProjects: z.number().int().nonnegative(),
            totalUsers: z.number().int().nonnegative()
        })),

    list: contract("POST", "/admin/list")
        .route({ description: "Lists entities with filtering, sorting, and pagination. Requires administrator permissions and an `elevated` grant." })
        .input(AdminListInputSchema)
        .output(createResultSchema(AdminListResultSchema)),

    update: contract("PATCH", "/admin/update")
        .route({ description: "Updates a single entity record. Requires administrator permissions and an `elevated` grant. Permission level changes require ROOT." })
        .input(AdminUpdateInputSchema)
        .output(createResultSchema(AdminUpdateResultSchema)),

    search: contract("POST", "/admin/search")
        .route({ description: "Fuzzy search across all entities. Requires administrator permissions and an `elevated` grant." })
        .input(AdminSearchInputSchema)
        .output(createResultSchema(AdminSearchOutputSchema))
};
