import { createAuthorize, type Policies, type Refusal } from "@/policy.js";

function refusal(error: Refusal["error"], message: string): Refusal {
    return { error, message };
}

const APP_NOT_FOUND = (input: { id: string }) => refusal("NOT_FOUND", `App with ID ${input.id} not found.`);

/**
 * Who may call each procedure. This is the whole of Lapse's authorization: a handler does not check who is calling
 * it, so a rule that isn't written here doesn't exist. See `policy.ts` for what each field means.
 *
 * Three things hold for every policy, because `authorize` enforces them rather than this table:
 * - administrator powers (`level`, and `alsoFor` on a resource) need the Lapse website's own session, so a
 *   third-party app an admin signed into can never use them;
 * - a program key gets them only with the admin scope named by `program`, and never where `ROOT` is required;
 * - a third-party app needs every scope in `scopes`.
 */
export const POLICIES = {
    user: {
        myself: { access: "public" },
        query: { access: "public" },
        queryByEmail: { access: "any", scopes: ["user:read"], level: "ADMIN", program: "admin:read" },
        update: {
            access: "any",
            scopes: ["user:write"],
            program: "admin:write",
            resource: {
                kind: "user",
                id: input => input.id,
                alsoFor: "ADMIN",
                missing: () => refusal("NOT_FOUND", "The given user could not be found."),
                denied: () => refusal("NO_PERMISSION", "You can only edit your own profile")
            }
        },
        getDevices: { access: "user", scopes: ["user:read"] },
        registerDevice: { access: "user", scopes: ["user:write"] },
        removeDevice: { access: "user", scopes: ["user:write"] },
        signOut: { access: "public" },
        hackatimeProjects: { access: "user", scopes: ["user:read"] },
        getTotalTimelapseTime: { access: "user", scopes: ["timelapse:read"] },
        emitHeartbeat: { access: "user", scopes: ["user:write"] },
        requestKeyRelay: { access: "user", scopes: ["user:keyrelay"] },
        queryKeyRelayRequest: { access: "user", scopes: ["user:keyrelay"] },
        provideKeyRelay: { access: "user", scopes: ["user:keyrelay"] },
        denyKeyRelay: { access: "user", scopes: ["user:keyrelay"] },
        receiveKeyRelay: { access: "user", scopes: ["user:keyrelay"] }
    },

    timelapse: {
        query: { access: "public" },
        publish: { access: "user", scopes: ["timelapse:write"] },
        update: {
            access: "any",
            scopes: ["timelapse:write"],
            program: "admin:write",
            resource: {
                kind: "timelapse",
                id: input => input.id,
                alsoFor: "ADMIN",
                missing: () => refusal("NOT_FOUND", "Couldn't find that timelapse!"),
                denied: () => refusal("NOT_FOUND", "You don't have permission to edit this timelapse")
            }
        },
        delete: {
            access: "any",
            scopes: ["timelapse:write"],
            program: "admin:write",
            resource: {
                kind: "timelapse",
                id: input => input.id,
                alsoFor: "ADMIN",
                missing: () => refusal("NOT_FOUND", "Couldn't find that timelapse!"),
                denied: () => refusal("NO_PERMISSION", "You don't have permission to delete this timelapse")
            }
        },
        findByUser: { access: "public" },
        myPublishedTimelapses: { access: "user", scopes: ["timelapse:read"] },
        syncWithHackatime: { access: "user", scopes: ["timelapse:write"] },

        // Only the Lapse website may pair a device: the token it leads to never expires and outlives any OAuth grant,
        // so a third-party app with `timelapse:write` must not be able to mint one for itself.
        approveDesktopPairing: { access: "user", firstParty: true },
        listDesktopDevices: { access: "user", scopes: ["timelapse:read"] },
        revokeDesktopDevice: { access: "user", scopes: ["timelapse:write"] },
        assignBrowserLabelVariant: { access: "user", scopes: ["timelapse:write"] },
        assignBrowserWarningVariant: { access: "user", scopes: ["timelapse:write"] },
        getRecordingAvailability: { access: "user", scopes: ["timelapse:read"] },
        createRecordingSession: { access: "user", scopes: ["timelapse:write"] },
        getLookoutDrafts: { access: "user", scopes: ["timelapse:read"] },
        discardLookoutDraft: { access: "user", scopes: ["timelapse:write"] },
        getArchivedLookoutDrafts: { access: "user", scopes: ["timelapse:read"] },
        restoreLookoutDraft: { access: "user", scopes: ["timelapse:write"] },
        pollLookoutStatus: { access: "user", scopes: ["timelapse:read"] },
        publishFromLookout: { access: "user", scopes: ["timelapse:write"] }
    },

    draftTimelapse: {
        query: {
            access: "any",
            scopes: ["timelapse:read"],
            program: "admin:read",
            resource: {
                kind: "draftTimelapse",
                id: input => input.id,
                alsoFor: "ADMIN",
                missing: () => refusal("NOT_FOUND", "The requested draft timelapse doesn't exist."),
                denied: () => refusal("NOT_FOUND", "The requested draft timelapse doesn't exist.")
            }
        },
        findByUser: {
            access: "any",
            scopes: ["timelapse:read"],
            program: "admin:read",
            resource: {
                kind: "user",
                id: input => input.user,
                alsoFor: "ADMIN",
                missing: () => refusal("NO_PERMISSION", "You may only query draft timelapses for yourself."),
                denied: () => refusal("NO_PERMISSION", "You may only query draft timelapses for yourself.")
            }
        },
        create: { access: "user", scopes: ["timelapse:write"] },
        update: {
            access: "any",
            scopes: ["timelapse:write"],
            program: "admin:write",
            resource: {
                kind: "draftTimelapse",
                id: input => input.id,
                alsoFor: "ADMIN",
                missing: () => refusal("NOT_FOUND", "Couldn't find that draft timelapse!"),
                denied: () => refusal("NO_PERMISSION", "You don't have permission to edit this draft timelapse!")
            }
        },
        delete: {
            access: "any",
            scopes: ["timelapse:write"],
            program: "admin:write",
            resource: {
                kind: "draftTimelapse",
                id: input => input.id,
                alsoFor: "ADMIN",
                missing: () => refusal("NOT_FOUND", "Couldn't find that timelapse!"),
                denied: () => refusal("NO_PERMISSION", "You don't have permission to delete this timelapse")
            }
        },
        legacy: { access: "user", scopes: ["timelapse:read"] },
        markAsMigrated: {
            access: "user",
            scopes: ["timelapse:write"],
            resource: {
                kind: "legacyTimelapse",
                id: input => input.id,
                alsoFor: "ADMIN",
                missing: () => refusal("NOT_FOUND", "Couldn't find that legacy timelapse!"),
                denied: () => refusal("NO_PERMISSION", "You don't have permission to mark this legacy timelapse as migrated.")
            }
        }
    },

    comment: {
        create: { access: "user", scopes: ["comment:write"] },
        delete: {
            access: "any",
            scopes: ["comment:write"],
            program: "admin:write",
            resource: {
                kind: "comment",
                id: input => input.commentId,
                alsoFor: "ADMIN",
                missing: () => refusal("NOT_FOUND", "Comment not found."),
                denied: () => refusal("NO_PERMISSION", "You can only delete your own comments.")
            }
        }
    },

    developer: {
        // The Lapse website's own OAuth client belongs to nobody. Only ROOT may rotate its secret or revoke it.
        rotateAppSecret: {
            access: "user",
            firstParty: true,
            resource: { kind: "app", id: input => input.id, alsoFor: "ROOT", onlyIf: app => app.canonical === true, missing: APP_NOT_FOUND, denied: APP_NOT_FOUND }
        },
        updateApp: {
            access: "user",
            firstParty: true,
            resource: { kind: "app", id: input => input.id, alsoFor: "ADMIN", missing: APP_NOT_FOUND, denied: APP_NOT_FOUND }
        },
        revokeApp: {
            access: "user",
            firstParty: true,
            resource: { kind: "app", id: input => input.id, alsoFor: "ROOT", onlyIf: app => app.canonical === true, missing: APP_NOT_FOUND, denied: APP_NOT_FOUND }
        },
        getAllOwnedApps: { access: "user", firstParty: true },
        createApp: { access: "user", firstParty: true },
        getAllApps: { access: "any", level: "ADMIN", program: "admin:panel" },
        updateAppTrustLevel: { access: "user", level: "ADMIN" },
        getOwnedOAuthGrants: { access: "user", firstParty: true },
        revokeOAuthGrant: {
            access: "user",
            firstParty: true,
            resource: {
                kind: "oauthGrant",
                id: input => input.grantId,
                missing: input => refusal("NOT_FOUND", `Grant with ID ${input.grantId} not found.`),
                denied: () => refusal("NO_PERMISSION", "You do not have permission to revoke this grant.")
            }
        },
        getAppByClientId: { access: "public" }
    },

    global: {
        weeklyLeaderboard: { access: "public" },
        recentTimelapses: { access: "public" },
        activeUsers: { access: "public" },
        stats: { access: "public" },
        maintenance: { access: "public" }
    },

    hackatime: {
        allProjects: { access: "user", scopes: ["timelapse:read"] },
        linkStatus: { access: "user", scopes: ["timelapse:read"] },
        myTimelapsesForProject: { access: "user", scopes: ["timelapse:read"] },
        timelapsesForProject: { access: "public" }
    },

    auth: {
        authorize: { access: "public" },
        grantConsent: { access: "user", firstParty: true },
        token: { access: "public" },

        // The token being moved is the credential, so there's nobody to be signed in as yet.
        session: { access: "public" },
        signInWithPassword: { access: "public" },
        hackatimeCallback: { access: "public" },
        continue: { access: "public" }
    },

    admin: {
        auditLog: { access: "any", level: "ADMIN", program: "admin:panel" },
        stats: { access: "any", level: "ADMIN", program: "admin:panel" },
        list: { access: "any", level: "ADMIN", program: "admin:panel" },
        update: { access: "user", level: "ADMIN" },
        search: { access: "any", level: "ADMIN", program: "admin:panel" },
        export: { access: "any", level: "ADMIN", program: "admin:panel" },
        recalculateDurations: { access: "any", level: "ADMIN", program: "admin:panel" },
        resyncHackatime: { access: "any", level: "ADMIN", program: "admin:panel" },
        programKey: {
            create: { access: "user", level: "ROOT" },
            list: { access: "user", level: "ROOT" },
            rotate: { access: "user", level: "ROOT" },
            revoke: { access: "user", level: "ROOT" },
            update: { access: "user", level: "ROOT" }
        }
    }
} satisfies Policies;

/**
 * The middleware every procedure starts with: `os.update.use(authorize("timelapse.update"))`.
 */
export const authorize = createAuthorize(POLICIES);

