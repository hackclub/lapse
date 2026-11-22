import type { FlattenUnion } from "@hackclub/lapse-shared";

/**
 * OAuth scopes, sorted into user-friendly groups.
 */
export const OAUTH_SCOPE_GROUPS = {
    Timelapses: {
        "timelapse:read": "View your timelapses",
        "timelapse:write": "Create and update timelapses",
        "snapshot:read": "View timelapse snapshots",
        "snapshot:write": "Delete timelapse snapshots",
    },
    Comments: {
        "comment:write": "Create and delete comments",
    },
    Profile: {
        "user:read": "Read your profile",
        "user:write": "Update your profile",
        "user:keyrelay": "Exchange encryption keys between devices",
    }
} as const;

/**
 * Represents a supported Lapse OAuth scope.
 */
export type LapseOAuthScope =
    keyof FlattenUnion<(typeof OAUTH_SCOPE_GROUPS)[keyof typeof OAUTH_SCOPE_GROUPS]> // regular scopes
    | "elevated"; // internal scopes

/**
 * Gets all possible `LapseOAuthScope` values.
 */
export function getAllOAuthScopes(): LapseOAuthScope[] {
    return [
        ...Object.values(OAUTH_SCOPE_GROUPS).flatMap(x => Object.keys(x) as LapseOAuthScope[]),
        "elevated"
    ];
}

/**
 * Gets the descriptions for each OAuth scope.
 */
export function getScopeDescriptions() {
    const entries: Record<string, string> = {};

    for (const group of Object.values(OAUTH_SCOPE_GROUPS)) {
        for (const [scope, description] of Object.entries(group)) {
            entries[scope] = description;
        }
    }

    return entries as Record<LapseOAuthScope, string>;
}

/**
 * Scopes that only program keys can hold. They stand in for the permission level a user would have: without one, a
 * program key can do nothing that an ordinary user couldn't do to somebody else's data.
 */
export const PROGRAM_KEY_ADMIN_SCOPES = {
    "admin:read": "Read what belongs to any user, the way an administrator can",
    "admin:write": "Change or delete what belongs to any user, the way an administrator can",
    "admin:panel": "Use the admin panel's own tools: listings, exports, the audit log, bulk fixes",
} as const;

/**
 * Every scope a program key can hold, sorted into user-friendly groups.
 */
export const PROGRAM_KEY_SCOPE_GROUPS = {
    ...OAUTH_SCOPE_GROUPS,
    Administration: PROGRAM_KEY_ADMIN_SCOPES
} as const;

/**
 * Represents a scope that only a program key can hold.
 */
export type ProgramKeyAdminScope = keyof typeof PROGRAM_KEY_ADMIN_SCOPES;

/**
 * Represents a scope a program key can hold: any scope a third-party app can be granted, plus the admin scopes.
 */
export type ProgramKeyScope = Exclude<LapseOAuthScope, "elevated"> | ProgramKeyAdminScope;

/**
 * Gets all possible `ProgramKeyScope` values.
 */
export function getAllProgramKeyScopes(): ProgramKeyScope[] {
    return [
        ...getAllOAuthScopes().filter((x): x is Exclude<LapseOAuthScope, "elevated"> => x !== "elevated"),
        ...Object.keys(PROGRAM_KEY_ADMIN_SCOPES) as ProgramKeyAdminScope[]
    ];
}
