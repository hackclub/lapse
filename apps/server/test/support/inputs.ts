import jwt from "jsonwebtoken";

import { CANONICAL_CLIENT_ID } from "./env.js";
import { rowId } from "./fakeDatabase.js";
import { OWNER_ID } from "./world.js";

const UUID = "3f2b8a5e-7c1d-4e9a-8b6f-0d2c4e6a8b10";
const ENTITY_ID = "entity000001";

/**
 * A valid input for every procedure, aimed at something `OWNER_ID` owns. The tests walk the router and fail on a
 * procedure that isn't listed here, so a new procedure can't go untested by being left out.
 */
export const INPUTS: Record<string, unknown> = {
    "user.myself": {},
    "user.query": { id: OWNER_ID },
    "user.queryByEmail": { email: "somebody@lapse.test" },
    "user.update": { id: OWNER_ID, changes: { displayName: "Somebody" } },
    "user.getDevices": {},
    "user.registerDevice": { name: "Laptop" },
    "user.removeDevice": { id: UUID },
    "user.signOut": {},
    "user.hackatimeProjects": {},
    "user.getTotalTimelapseTime": { id: OWNER_ID },
    "user.emitHeartbeat": {},
    "user.requestKeyRelay": { targetDevice: UUID, callingDevice: UUID },
    "user.queryKeyRelayRequest": { callingDevice: UUID },
    "user.provideKeyRelay": { exchangeId: UUID, deviceKey: "00".repeat(16) },
    "user.denyKeyRelay": { exchangeId: UUID },
    "user.receiveKeyRelay": { exchangeId: UUID },

    "timelapse.query": { id: ENTITY_ID },
    "timelapse.publish": { id: ENTITY_ID, visibility: "PUBLIC", deviceKey: "00".repeat(16) },
    "timelapse.update": { id: ENTITY_ID, changes: { name: "A new name" } },
    "timelapse.delete": { id: ENTITY_ID },
    "timelapse.findByUser": { user: OWNER_ID },
    "timelapse.syncWithHackatime": { id: ENTITY_ID, hackatimeProject: "lapse" },
    "timelapse.approveDesktopPairing": { challenge: "challenge", label: "Laptop" },
    "timelapse.listDesktopDevices": {},
    "timelapse.revokeDesktopDevice": { id: ENTITY_ID },
    "timelapse.assignBrowserLabelVariant": {},
    "timelapse.assignBrowserWarningVariant": {},
    "timelapse.getRecordingAvailability": {},
    "timelapse.createRecordingSession": { mode: "desktop" },
    "timelapse.getLookoutDrafts": {},
    "timelapse.discardLookoutDraft": { id: ENTITY_ID },
    "timelapse.getArchivedLookoutDrafts": {},
    "timelapse.restoreLookoutDraft": { id: ENTITY_ID },
    "timelapse.publishFromLookout": { draftId: ENTITY_ID, name: "A timelapse", visibility: "PUBLIC" },
    "timelapse.pollLookoutStatus": { draftId: ENTITY_ID },
    "timelapse.myPublishedTimelapses": { limit: 20 },

    "draftTimelapse.findByUser": { user: OWNER_ID },
    "draftTimelapse.query": { id: ENTITY_ID },
    "draftTimelapse.create": {
        name: "A draft",
        description: "",
        snapshots: [Date.parse("2025-01-01T00:00:00Z"), Date.parse("2025-01-01T00:01:00Z")],
        deviceId: UUID,
        sessions: [{ fileSize: 1024 }],
        thumbnailSize: 1024,
    },
    "draftTimelapse.update": { id: ENTITY_ID, changes: { name: "A new name", description: "", editList: [] } },
    "draftTimelapse.delete": { id: ENTITY_ID },
    "draftTimelapse.legacy": {},
    "draftTimelapse.markAsMigrated": { id: ENTITY_ID },

    "comment.create": { id: ENTITY_ID, content: "Nice!" },
    "comment.delete": { commentId: ENTITY_ID },

    "developer.rotateAppSecret": { id: UUID },
    "developer.updateApp": { id: UUID, name: "An app" },
    "developer.revokeApp": { id: UUID },
    "developer.getAllOwnedApps": {},
    "developer.createApp": { name: "An app", description: "", homepageUrl: "https://app.test", iconUrl: "", redirectUris: ["https://app.test/callback"], scopes: ["timelapse:read"] },
    "developer.getAllApps": {},
    "developer.updateAppTrustLevel": { id: UUID, trustLevel: "TRUSTED" },
    "developer.getOwnedOAuthGrants": {},
    "developer.revokeOAuthGrant": { grantId: UUID },
    "developer.getAppByClientId": { clientId: "svc_app" },

    "global.weeklyLeaderboard": {},
    "global.recentTimelapses": {},
    "global.activeUsers": {},
    "global.stats": {},
    "global.maintenance": {},

    "hackatime.allProjects": {},
    "hackatime.linkStatus": {},
    "hackatime.myTimelapsesForProject": { projectKey: "lapse" },
    "hackatime.timelapsesForProject": { hackatimeUserId: 4242, projectKey: "lapse" },

    "auth.authorize": {
        query: {
            response_type: "code",
            client_id: CANONICAL_CLIENT_ID,
            redirect_uri: "https://lapse.test/auth",
            scope: "elevated",
            state: "state",
            code_challenge: "challenge",
            code_challenge_method: "S256",
        },
    },
    "auth.grantConsent": { clientId: "svc_app", state: "state", scopes: ["timelapse:read"] },
    "auth.token": { body: { grant_type: "authorization_code", code: "code", redirect_uri: "https://lapse.test/auth", client_id: CANONICAL_CLIENT_ID, code_verifier: "verifier" } },
    "auth.signInWithPassword": { email: "review@lapse.test", password: "password", clientId: CANONICAL_CLIENT_ID, redirectUri: "https://lapse.test/auth", scope: "elevated", state: "state", codeChallenge: "challenge" },
    "auth.hackatimeCallback": { query: { code: "code", state: "state" } },
    "auth.continue": { query: { consentToken: jwt.sign({ sub: OWNER_ID, cid: CANONICAL_CLIENT_ID, scp: ["elevated"] }, "test-consent-token-secret") } },

    "admin.auditLog": { permissionChangesOnly: false, page: 1, pageSize: 20 },
    "admin.stats": {},
    "admin.list": { entity: "user", filters: [], page: 1, pageSize: 20 },
    "admin.update": { entity: "timelapse", id: ENTITY_ID, changes: { name: "A new name" } },
    "admin.search": { query: "somebody" },
    "admin.export": { entity: "user", id: OWNER_ID },
    "admin.recalculateDurations": {},
    "admin.resyncHackatime": { id: ENTITY_ID, dryRun: true, limit: 10 },
    "admin.programKey.create": { name: "A key", scopes: ["timelapse:read"], expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
    "admin.programKey.list": {},
    "admin.programKey.rotate": { id: rowId("programKey") },
    "admin.programKey.revoke": { id: rowId("programKey") },
    "admin.programKey.update": { id: rowId("programKey"), name: "A key" },
};
