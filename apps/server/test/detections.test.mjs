import assert from "node:assert/strict";
import test from "node:test";

import { handleDetectionRequest } from "../dist/detections.js";

const adminApiKey = "detection-secret";
const authorization = `Bearer ${adminApiKey}`;

function timelapse(overrides = {}) {
    return {
        id: "recording-1",
        name: "Build session",
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        visibility: "UNLISTED",
        duration: 120,
        s3Key: "private-storage-key.mp4",
        thumbnailS3Key: "private-thumbnail-key.jpg",
        lookoutVideoUrl: null,
        lookoutThumbnailUrl: null,
        hackatimeProject: "telescreen",
        snapshots: [
            new Date("2026-07-20T12:00:00.000Z"),
            new Date("2026-07-20T12:02:00.000Z")
        ],
        lookoutSessionId: null,
        lookoutToken: null,
        email: "private@example.com",
        arbitraryMetadata: { private: true },
        owner: {
            id: "lapse-user-1",
            handle: "analyst",
            displayName: "Analyst",
            hackatimeId: "42",
            email: "private@example.com",
            slackId: "U123"
        },
        ...overrides
    };
}

function dependencies(rows = []) {
    return {
        adminApiKey,
        findTimelapses: async ids => rows.filter(row => ids.includes(row.id)),
        getSession: async () => ({
            session: {
                id: "lookout-session",
                name: "secret name",
                status: "complete",
                metadata: { secret: true },
                trackedSeconds: 118,
                videoUrl: "https://lookout.example/video.mp4",
                thumbnailUrl: "https://lookout.example/thumbnail.jpg",
                trackingMode: "credit",
                totalActiveSeconds: 130,
                token: "lookout-secret"
            },
            trackedSeconds: 118,
            screenshotCount: 3,
            clientInfo: "lapse-desktop/2.0 macOS"
        }),
        getTimings: async () => ({
            status: "complete",
            count: 3,
            first: "2026-07-20T12:00:00.000Z",
            last: "2026-07-20T12:02:00.000Z",
            clientInfo: null,
            timestamps: [
                "2026-07-20T12:00:00.000Z",
                "2026-07-20T12:01:00.000Z",
                "2026-07-20T12:02:00.000Z"
            ]
        }),
        publicStorageUrl: "https://media.lapse.example"
    };
}

async function request(body, deps = dependencies()) {
    return handleDetectionRequest({ authorization, body }, deps);
}

test("requires a configured narrow bearer credential", async () => {
    const unconfigured = await handleDetectionRequest(
        { authorization, body: { timelapseIds: [] } },
        { ...dependencies(), adminApiKey: undefined }
    );
    assert.equal(unconfigured.statusCode, 503);

    for (const header of [
        undefined,
        "Bearer wrong",
        `Bearer ${"x".repeat(adminApiKey.length)}`,
        `Bearer ${adminApiKey}extra`,
        adminApiKey
    ]) {
        const response = await handleDetectionRequest(
            { authorization: header, body: { timelapseIds: [] } },
            dependencies()
        );
        assert.equal(response.statusCode, 401);
    }
});

test("validates, trims, deduplicates, and caps requested IDs", async () => {
    for (const body of [{}, { timelapseIds: "one" }, { timelapseIds: [""] }, {
        timelapseIds: Array.from({ length: 26 }, (_, index) => `id-${index}`)
    }]) {
        assert.equal((await request(body)).statusCode, 400);
    }

    const seen = [];
    const response = await request(
        { timelapseIds: [" recording-1 ", "recording-1"] },
        { ...dependencies(), findTimelapses: async ids => { seen.push(...ids); return []; } }
    );
    assert.deepEqual(seen, ["recording-1"]);
    assert.deepEqual(response.body, {
        results: [{ timelapseId: "recording-1", status: "not_found" }]
    });
});

test("returns one ordered result per requested ID including missing IDs", async () => {
    const response = await request(
        { timelapseIds: ["missing", "recording-1"] },
        dependencies([timelapse()])
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.results.map(result => result.status), ["not_found", "found"]);
});

test("maps legacy recordings without inventing Lookout evidence", async () => {
    const response = await request({ timelapseIds: ["recording-1"] }, dependencies([timelapse()]));
    const result = response.body.results[0];
    assert.equal(result.provenance, "legacy");
    assert.equal(result.lookoutEvidence, null);
    assert.equal(result.recording.playbackUrl, "https://media.lapse.example/private-storage-key.mp4");
    assert.deepEqual(result.recording.snapshotTimestamps, [1784548800000, 1784548920000]);
});

test("maps Lookout recordings to server-validated timing evidence", async () => {
    const row = timelapse({
        lookoutSessionId: "lookout-session",
        lookoutToken: "lookout-secret",
        lookoutVideoUrl: "https://lookout.example/video.mp4",
        lookoutThumbnailUrl: "https://lookout.example/thumbnail.jpg"
    });
    const response = await request({ timelapseIds: [row.id] }, dependencies([row]));
    const result = response.body.results[0];
    assert.equal(result.provenance, "lookout");
    assert.deepEqual(result.lookoutEvidence, {
        state: "available",
        status: "complete",
        trackingMode: "credit",
        trackedSeconds: 118,
        activeSeconds: 130,
        screenshotCount: 3,
        captureRange: { first: 1784548800000, last: 1784548920000 },
        captureTimestamps: [1784548800000, 1784548860000, 1784548920000],
        clientInfo: "lapse-desktop/2.0 macOS"
    });
});

test("marks Lookout evidence unavailable without hiding the recording", async () => {
    const row = timelapse({ lookoutSessionId: "lookout-session", lookoutToken: "lookout-secret" });
    const deps = dependencies([row]);
    deps.getSession = async () => { throw new Error("private upstream failure"); };
    const response = await request({ timelapseIds: [row.id] }, deps);
    assert.equal(response.body.results[0].status, "found");
    assert.deepEqual(response.body.results[0].lookoutEvidence, { state: "unavailable" });

    const missingToken = timelapse({ lookoutSessionId: "lookout-session" });
    const missingTokenResponse = await request(
        { timelapseIds: [missingToken.id] },
        dependencies([missingToken])
    );
    assert.deepEqual(missingTokenResponse.body.results[0].lookoutEvidence, { state: "unavailable" });
});

test("excludes credentials, identity secrets, metadata, storage keys, and upstream errors", async () => {
    const row = timelapse({
        lookoutSessionId: "lookout-session",
        lookoutToken: "lookout-secret",
        lookoutVideoUrl: "https://lookout.example/video.mp4",
        lookoutThumbnailUrl: "https://lookout.example/thumbnail.jpg"
    });
    const response = await request({ timelapseIds: [row.id] }, dependencies([row]));
    const json = JSON.stringify(response.body);
    for (const sensitive of [
        "private@example.com",
        "U123",
        "lookout-secret",
        "private-storage-key",
        "private-thumbnail-key",
        "arbitraryMetadata",
        "secret name",
        "metadata"
    ]) assert.equal(json.includes(sensitive), false, sensitive);
    for (const result of response.body.results)
        for (const field of ["s3Key", "thumbnailS3Key", "lookoutToken"])
            assert.equal(Object.hasOwn(result, field), false, field);
});
