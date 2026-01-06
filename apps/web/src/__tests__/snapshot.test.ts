import { setupDatabaseMock, mockDatabase, resetMockDatabase } from "@/__tests__/mocks/database";
import { createMockContext } from "@/__tests__/mocks/trpc";
import { testFactory } from "@/__tests__/factories";
import { describe, it, expect, beforeEach } from "vitest";
import snapshot from "@/server/routers/api/snapshot";

setupDatabaseMock();

const createCaller = (ctx: ReturnType<typeof createMockContext>) =>
    snapshot.createCaller(ctx);

describe("Snapshot API Router", () => {
    beforeEach(() => {
        resetMockDatabase();
    });

    it("should return NOT_FOUND when deleting a non-existent snapshot", async () => {
        const mockUser = testFactory.user();
        mockDatabase.snapshot.findFirst.mockResolvedValueOnce(null);

        const caller = createCaller(createMockContext(mockUser));
        const result = await caller.delete({ id: "00000000-0000-0000-0000-000000000000" });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe("NOT_FOUND");
        }
    });

    it("should delete a snapshot", async () => {
        // Arrange: create a mock user and snapshot
        const mockUser = testFactory.user();
        const mockTimelapse = testFactory.timelapse({ ownerId: mockUser.id });
        const mockSnapshot = testFactory.snapshot({ timelapseId: mockTimelapse.id });
        mockDatabase.snapshot.findFirst.mockResolvedValueOnce({
            ...mockSnapshot,
            timelapse: mockTimelapse,
        });
        mockDatabase.snapshot.delete.mockResolvedValueOnce(mockSnapshot);

        // Act: call the delete snapshot API
        const caller = createCaller(createMockContext(mockUser));
        const result = await caller.delete({ id: mockSnapshot.id });

        // Assert: verify the snapshot was deleted
        expect(result.ok).toBe(true);
        expect(mockDatabase.snapshot.delete).toHaveBeenCalledWith({
            where: { id: mockSnapshot.id },
        });
    });

    it("should find snapshots by timelapse", async () => {
        // Arrange: create a mock timelapse and snapshots
        const mockUser = testFactory.user();
        const mockTimelapse = testFactory.timelapse({ ownerId: mockUser.id, isPublished: true });
        const mockSnapshots = [
            testFactory.snapshot({ timelapseId: mockTimelapse.id }),
            testFactory.snapshot({ timelapseId: mockTimelapse.id }),
        ];
        mockDatabase.timelapse.findFirst.mockResolvedValueOnce(mockTimelapse);
        mockDatabase.snapshot.findMany.mockResolvedValueOnce(mockSnapshots);

        // Act: call the findByTimelapse API
        const caller = createCaller(createMockContext(mockUser));
        const result = await caller.findByTimelapse({ timelapseId: mockTimelapse.id });

        // Assert: verify the snapshots were returned
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.snapshots).toHaveLength(2);
        }
    });

    it("should return NOT_FOUND when timelapse does not exist in findByTimelapse", async () => {
        const mockUser = testFactory.user();
        mockDatabase.timelapse.findFirst.mockResolvedValueOnce(null);
        const caller = createCaller(createMockContext(mockUser));
        const result = await caller.findByTimelapse({ timelapseId: "00000000-0000-0000-0000-000000000000" });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe("NOT_FOUND");
        }
    });

    it("should return NOT_MUTABLE when deleting a snapshot from a published timelapse", async () => {
        const mockUser = testFactory.user();
        const mockTimelapse = testFactory.timelapse({ ownerId: mockUser.id, isPublished: true });
        const mockSnapshot = testFactory.snapshot({ timelapseId: mockTimelapse.id });

        mockDatabase.snapshot.findFirst.mockResolvedValueOnce({
            ...mockSnapshot,
            timelapse: mockTimelapse,
        });

        const caller = createCaller(createMockContext(mockUser));
        const result = await caller.delete({ id: mockSnapshot.id });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe("NOT_MUTABLE");
        }
    });
});
