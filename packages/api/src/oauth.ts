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
