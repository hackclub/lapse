import type { FlattenUnion } from "@hackclub/lapse-shared";

/**
 * Program key scopes, sorted into user-friendly groups.
 * These are distinct from OAuth scopes — they grant service-wide access
 * rather than acting on behalf of a specific user.
 */
export const PROGRAM_SCOPE_GROUPS = {
    Data: {
        "program:read": "Read all platform data",
        "program:write": "Modify platform data",
    },
    Management: {
        "program:admin": "Manage program keys",
    }
} as const;

/**
 * Represents a supported Lapse program key scope.
 */
export type LapseProgramScope =
    keyof FlattenUnion<(typeof PROGRAM_SCOPE_GROUPS)[keyof typeof PROGRAM_SCOPE_GROUPS]>;

/**
 * Gets all possible `LapseProgramScope` values.
 */
export function getAllProgramScopes(): LapseProgramScope[] {
    return Object.values(PROGRAM_SCOPE_GROUPS).flatMap(x => Object.keys(x) as LapseProgramScope[]);
}

/**
 * Gets the descriptions for each program scope.
 */
export function getProgramScopeDescriptions() {
    const entries: Record<string, string> = {};

    for (const group of Object.values(PROGRAM_SCOPE_GROUPS)) {
        for (const [scope, description] of Object.entries(group)) {
            entries[scope] = description;
        }
    }

    return entries as Record<LapseProgramScope, string>;
}
