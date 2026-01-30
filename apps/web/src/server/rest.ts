import "@/server/allow-only-server";

type RestMethod = "GET" | "POST" | "PATCH" | "DELETE";

type RestProcedure = {
  method: RestMethod;
  type: "query" | "mutation";
  scopes: string[];
  summary: string;
  requiresAuth: boolean;
};

export const REST_PROCEDURES = {
  timelapse: {
    query: {
      method: "GET",
      type: "query",
      scopes: ["timelapse:read"],
      summary: "Fetch a timelapse by id",
      requiresAuth: false,
    },
    createDraft: {
      method: "POST",
      type: "mutation",
      scopes: ["timelapse:write"],
      summary: "Create a draft timelapse",
      requiresAuth: true,
    },
    commit: {
      method: "POST",
      type: "mutation",
      scopes: ["timelapse:write"],
      summary: "Commit a draft timelapse",
      requiresAuth: true,
    },
    update: {
      method: "PATCH",
      type: "mutation",
      scopes: ["timelapse:write"],
      summary: "Update timelapse metadata",
      requiresAuth: true,
    },
    delete: {
      method: "DELETE",
      type: "mutation",
      scopes: ["timelapse:write"],
      summary: "Delete a timelapse",
      requiresAuth: true,
    },
    publish: {
      method: "POST",
      type: "mutation",
      scopes: ["timelapse:write"],
      summary: "Publish a timelapse",
      requiresAuth: true,
    },
    findByUser: {
      method: "GET",
      type: "query",
      scopes: ["timelapse:read"],
      summary: "List timelapses by user",
      requiresAuth: false,
    },
    syncWithHackatime: {
      method: "POST",
      type: "mutation",
      scopes: ["timelapse:write"],
      summary: "Sync timelapse with Hackatime",
      requiresAuth: true,
    },
  },
  user: {
    myself: {
      method: "GET",
      type: "query",
      scopes: ["user:read"],
      summary: "Get current user",
      requiresAuth: false,
    },
    query: {
      method: "GET",
      type: "query",
      scopes: ["user:read"],
      summary: "Fetch user profile",
      requiresAuth: false,
    },
    update: {
      method: "PATCH",
      type: "mutation",
      scopes: ["user:write"],
      summary: "Update user profile",
      requiresAuth: true,
    },
    getDevices: {
      method: "GET",
      type: "query",
      scopes: ["user:read"],
      summary: "List registered devices",
      requiresAuth: true,
    },
    registerDevice: {
      method: "POST",
      type: "mutation",
      scopes: ["user:write"],
      summary: "Register a new device",
      requiresAuth: true,
    },
    removeDevice: {
      method: "DELETE",
      type: "mutation",
      scopes: ["user:write"],
      summary: "Remove a device",
      requiresAuth: true,
    },
    signOut: {
      method: "POST",
      type: "mutation",
      scopes: [],
      summary: "Sign out the current user",
      requiresAuth: false,
    },
    hackatimeProjects: {
      method: "GET",
      type: "query",
      scopes: ["user:read"],
      summary: "List Hackatime projects",
      requiresAuth: true,
    },
    getTotalTimelapseTime: {
      method: "GET",
      type: "query",
      scopes: ["user:read"],
      summary: "Get total timelapse time",
      requiresAuth: false,
    },
    emitHeartbeat: {
      method: "POST",
      type: "mutation",
      scopes: ["user:write"],
      summary: "Emit user heartbeat",
      requiresAuth: true,
    },
  },
  snapshot: {
    delete: {
      method: "DELETE",
      type: "mutation",
      scopes: ["snapshot:write"],
      summary: "Delete a snapshot",
      requiresAuth: true,
    },
    findByTimelapse: {
      method: "GET",
      type: "query",
      scopes: ["snapshot:read"],
      summary: "List snapshots by timelapse",
      requiresAuth: false,
    },
  },
  comment: {
    create: {
      method: "POST",
      type: "mutation",
      scopes: ["comment:write"],
      summary: "Create a comment",
      requiresAuth: true,
    },
    delete: {
      method: "DELETE",
      type: "mutation",
      scopes: ["comment:write"],
      summary: "Delete a comment",
      requiresAuth: true,
    },
  },
  global: {
    weeklyLeaderboard: {
      method: "GET",
      type: "query",
      scopes: ["global:read"],
      summary: "Get weekly leaderboard",
      requiresAuth: false,
    },
    recentTimelapses: {
      method: "GET",
      type: "query",
      scopes: ["global:read"],
      summary: "Get recent timelapses",
      requiresAuth: false,
    },
    activeUsers: {
      method: "GET",
      type: "query",
      scopes: ["global:read"],
      summary: "Get active users count",
      requiresAuth: false,
    },
  },
} as const satisfies Record<string, Record<string, RestProcedure>>;

export type RestRouterName = keyof typeof REST_PROCEDURES;
export type RestProcedureName<T extends RestRouterName> =
  keyof (typeof REST_PROCEDURES)[T];

export function getRestProcedure(
  router: string,
  procedure: string,
): RestProcedure | null {
  const routerEntry = REST_PROCEDURES[router as RestRouterName];
  if (!routerEntry) return null;

  const proc = (routerEntry as Record<string, RestProcedure>)[procedure];
  if (!proc) return null;

  return proc;
}
