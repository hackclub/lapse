import "./support/env.js";

import assert from "node:assert/strict";
import test from "node:test";

import { capSnapshotsToVideo, durationBySnapshots } from "@/routers/timelapse.js";

function every(seconds: number, count: number) {
    const start = Date.UTC(2026, 0, 1);
    return Array.from({ length: count }, (_, i) => new Date(start + i * seconds * 1000));
}

test("a real recording keeps every snapshot, even claiming more than its video holds", () => {
    // An hour of snapshots for 40 minutes of video - edits cut footage, not snapshots.
    const snapshots = every(10, 361);
    assert.equal(capSnapshotsToVideo(snapshots, 40 * 60), snapshots);
});

test("a forged draft keeps only as much time as its video could account for", () => {
    // A day of made-up snapshots for 30 seconds of video.
    const snapshots = every(119, 726);
    const kept = capSnapshotsToVideo(snapshots, 30);

    assert.ok(durationBySnapshots(kept) <= 30 * 2 + 600);
    assert.ok(kept.length < 10);
    assert.deepEqual(kept, snapshots.slice(0, kept.length));
});
