import { FlattenUnion } from "@/shared/common";

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
  },
} as const;

export type OAuthScope = keyof FlattenUnion<(typeof OAUTH_SCOPE_GROUPS)[keyof typeof OAUTH_SCOPE_GROUPS]>;

export function getAllOAuthScopes() {
  return Object.values(OAUTH_SCOPE_GROUPS).flatMap((group) => Object.keys(group));
}

export function getScopeDescriptions() {
  const entries: Record<string, string> = {};

  for (const group of Object.values(OAUTH_SCOPE_GROUPS)) {
    for (const [scope, description] of Object.entries(group)) {
      entries[scope] = description;
    }
  }

  return entries;
}
