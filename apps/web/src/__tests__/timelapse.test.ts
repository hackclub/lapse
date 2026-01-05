import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupDatabaseMock, mockDatabase, resetMockDatabase } from "@/__tests__/mocks/database";
import { createMockContext } from "@/__tests__/mocks/trpc";
import { testFactory } from "@/__tests__/factories";
import { setupEnvMock } from "@/__tests__/mocks/env";
import { mockS3Send, setupS3Mock } from "@/__tests__/mocks/s3";
import { setupEncryptionMock, mockDecryptVideo } from "@/__tests__/mocks/encryption";
import { setupVideoProcessingMock, mockGenerateThumbnail } from "@/__tests__/mocks/videoProcessing";
import timelapse from "@/server/routers/api/timelapse";

setupDatabaseMock();
setupEnvMock();
setupS3Mock();
setupEncryptionMock();
setupVideoProcessingMock();

const createCaller = (ctx: ReturnType<typeof createMockContext>) => timelapse.createCaller(ctx);

describe("timelapse router", () => {
    beforeEach(() => {
        resetMockDatabase();
    });

    describe("query", () => {
        it("should return a published timelapse for anonymous users", async () => {
            const owner = testFactory.user();
            const mockTimelapse = testFactory.timelapse({ ownerId: owner.id, isPublished: true, visibility: "PUBLIC" });
            
            mockDatabase.timelapse.findFirst.mockResolvedValue({
                ...mockTimelapse,
                owner,
                device: null,
                comments: []
            });


            const caller = createCaller(createMockContext(null));
            const result = await caller.query({ id: mockTimelapse.id });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapse.id).toBe(mockTimelapse.id);
                expect(result.data.timelapse.name).toBe(mockTimelapse.name);
                expect(result.data.timelapse.private).toBeUndefined();
            }
        });

        it("should return owned timelapse with private data for owner", async () => {
            const owner = testFactory.user();
            const device = testFactory.device({ ownerId: owner.id });
            const mockTimelapse = testFactory.timelapse({ ownerId: owner.id, deviceId: device.id, isPublished: false });
            
            mockDatabase.timelapse.findFirst.mockResolvedValue({
                ...mockTimelapse,
                owner,
                device,
                comments: []
            });

            const caller = createCaller(createMockContext(owner));
            const result = await caller.query({ id: mockTimelapse.id });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapse.id).toBe(mockTimelapse.id);
                expect(result.data.timelapse.private).toBeDefined();
                expect(result.data.timelapse.private?.device?.id).toBe(device.id);
            }
        });

        it("should return NOT_FOUND for unpublished timelapse when not owner", async () => {
            const owner = testFactory.user();
            const otherUser = testFactory.user();
            const mockTimelapse = testFactory.timelapse({ ownerId: owner.id, isPublished: false });
            
            mockDatabase.timelapse.findFirst.mockResolvedValue({
                ...mockTimelapse,
                owner,
                device: null,
                comments: []
            });

            const caller = createCaller(createMockContext(otherUser));
            const result = await caller.query({ id: mockTimelapse.id });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NOT_FOUND");
            }
        });

        it("should return NOT_FOUND when timelapse does not exist", async () => {
            mockDatabase.timelapse.findFirst.mockResolvedValue(null);

            const caller = createCaller(createMockContext(null));
            const result = await caller.query({ id: "non-existent-id" });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NOT_FOUND");
            }
        });
    });

    describe("createDraft", () => {
        it("should create a draft timelapse with upload tokens", async () => {
            const user = testFactory.user();
            const videoToken = testFactory.uploadToken({ ownerId: user.id });
            const thumbnailToken = testFactory.uploadToken({ ownerId: user.id });
            const draft = testFactory.draftTimelapse({ ownerId: user.id, videoTokenId: videoToken.id, thumbnailTokenId: thumbnailToken.id });

            mockDatabase.uploadToken.create.mockResolvedValueOnce(videoToken);
            mockDatabase.uploadToken.create.mockResolvedValueOnce(thumbnailToken);
            mockDatabase.draftTimelapse.create.mockResolvedValue(draft);

            const caller = createCaller(createMockContext(user));
            const result = await caller.createDraft({ containerType: "WEBM" });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.id).toBe(draft.id);
                expect(result.data.videoToken).toBe(videoToken.id);
                expect(result.data.thumbnailToken).toBe(thumbnailToken.id);
            }
        });

        it("should create tokens with correct MIME types for MP4", async () => {
            const user = testFactory.user();
            const videoToken = testFactory.uploadToken({ ownerId: user.id, mimeType: "video/mp4" });
            const thumbnailToken = testFactory.uploadToken({ ownerId: user.id, mimeType: "image/jpeg" });
            const draft = testFactory.draftTimelapse({ ownerId: user.id });

            mockDatabase.uploadToken.create.mockResolvedValueOnce(videoToken);
            mockDatabase.uploadToken.create.mockResolvedValueOnce(thumbnailToken);
            mockDatabase.draftTimelapse.create.mockResolvedValue(draft);

            const caller = createCaller(createMockContext(user));
            const result = await caller.createDraft({ containerType: "MP4" });

            expect(result.ok).toBe(true);
            expect(mockDatabase.uploadToken.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        mimeType: "video/mp4"
                    })
                })
            );
        });
    });

    describe("commit", () => {
        it("should commit a draft timelapse", async () => {
            const user = testFactory.user();
            const device = testFactory.device({ ownerId: user.id });
            const videoToken = testFactory.uploadToken({ ownerId: user.id, uploaded: true, mimeType: "video/webm" });
            const thumbnailToken = testFactory.uploadToken({ ownerId: user.id, uploaded: true });
            const draft = testFactory.draftTimelapse({ 
                ownerId: user.id, 
                videoTokenId: videoToken.id, 
                thumbnailTokenId: thumbnailToken.id 
            });
            const mockTimelapse = testFactory.timelapse({ ownerId: user.id, deviceId: device.id });

            mockDatabase.draftTimelapse.findFirst.mockResolvedValue({
                ...draft,
                videoToken,
                thumbnailToken

            });
            
            mockDatabase.knownDevice.findFirst.mockResolvedValue(device);
            mockDatabase.timelapse.create.mockResolvedValue({
                ...mockTimelapse,
                owner: user,
                device,
                comments: []
            });
            mockDatabase.snapshot.createMany.mockResolvedValue({ count: 2 });
            mockDatabase.draftTimelapse.delete.mockResolvedValue(draft);

            const caller = createCaller(createMockContext(user));
            const result = await caller.commit({
                id: draft.id,
                name: "Test Timelapse",
                description: "A test timelapse",
                visibility: "PUBLIC",
                snapshots: [1000, 2000],
                deviceId: device.id
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapse.name).toBe(mockTimelapse.name);
            }
        });

        it("should return NOT_FOUND when draft does not exist", async () => {
            const user = testFactory.user();
            mockDatabase.draftTimelapse.findFirst.mockResolvedValue(null);

            const caller = createCaller(createMockContext(user));
            const result = await caller.commit({
                id: "non-existent",
                name: "Test",
                description: "",
                visibility: "PUBLIC",
                snapshots: [],
                deviceId: crypto.randomUUID()
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NOT_FOUND");
            }
        });

        it("should return NO_FILE when video not uploaded", async () => {
            const user = testFactory.user();
            const videoToken = testFactory.uploadToken({ ownerId: user.id, uploaded: false });
            const thumbnailToken = testFactory.uploadToken({ ownerId: user.id, uploaded: true });
            const draft = testFactory.draftTimelapse({ ownerId: user.id });

            mockDatabase.draftTimelapse.findFirst.mockResolvedValue({
                ...draft,
                videoToken,
                thumbnailToken
            });

            const caller = createCaller(createMockContext(user));
            const result = await caller.commit({
                id: draft.id,
                name: "Test",
                description: "",
                visibility: "PUBLIC",
                snapshots: [],
                deviceId: crypto.randomUUID()
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NO_FILE");
            }
        });

        it("should return DEVICE_NOT_FOUND when device does not exist", async () => {
            const user = testFactory.user();
            const videoToken = testFactory.uploadToken({ ownerId: user.id, uploaded: true });
            const thumbnailToken = testFactory.uploadToken({ ownerId: user.id, uploaded: true });
            const draft = testFactory.draftTimelapse({ ownerId: user.id });

            mockDatabase.draftTimelapse.findFirst.mockResolvedValue({
                ...draft,
                videoToken,
                thumbnailToken
            });
            mockDatabase.knownDevice.findFirst.mockResolvedValue(null);

            const caller = createCaller(createMockContext(user));
            const result = await caller.commit({
                id: draft.id,
                name: "Test",
                description: "",
                visibility: "PUBLIC",
                snapshots: [],
                deviceId: crypto.randomUUID()
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("DEVICE_NOT_FOUND");
            }
        });
    });


    describe("update", () => {
        it("should update timelapse metadata", async () => {
            const user = testFactory.user();
            const mockTimelapse = testFactory.timelapse({ ownerId: user.id });

            mockDatabase.timelapse.findFirst.mockResolvedValue(mockTimelapse);
            mockDatabase.timelapse.update.mockResolvedValue({
                ...mockTimelapse,
                name: "Updated Name",
                description: "Updated Description",
                owner: user,
                device: null,
                comments: []
            });

            const caller = createCaller(createMockContext(user));
            const result = await caller.update({
                id: mockTimelapse.id,
                changes: {
                    name: "Updated Name",
                    description: "Updated Description"
                }
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapse.name).toBe("Updated Name");
                expect(result.data.timelapse.description).toBe("Updated Description");
            }
        });

        it("should return NOT_FOUND when timelapse does not exist", async () => {
            const user = testFactory.user();
            mockDatabase.timelapse.findFirst.mockResolvedValue(null);

            const caller = createCaller(createMockContext(user));
            const result = await caller.update({
                id: "non-existent",
                changes: { name: "New Name" }
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NOT_FOUND");
            }
        });

        it("should return NOT_FOUND when user does not own timelapse", async () => {
            const owner = testFactory.user();
            const otherUser = testFactory.user();
            const mockTimelapse = testFactory.timelapse({ ownerId: owner.id });

            mockDatabase.timelapse.findFirst.mockResolvedValue(mockTimelapse);

            const caller = createCaller(createMockContext(otherUser));
            const result = await caller.update({
                id: mockTimelapse.id,
                changes: { name: "New Name" }
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NOT_FOUND");
            }
        });

        it("should allow admin to update any timelapse", async () => {
            const owner = testFactory.user();
            const admin = testFactory.user({ permissionLevel: "ADMIN" });
            const mockTimelapse = testFactory.timelapse({ ownerId: owner.id });

            mockDatabase.timelapse.findFirst.mockResolvedValue(mockTimelapse);
            mockDatabase.timelapse.update.mockResolvedValue({
                ...mockTimelapse,
                name: "Admin Updated",
                owner,
                device: null,
                comments: []
            });

            const caller = createCaller(createMockContext(admin));
            const result = await caller.update({
                id: mockTimelapse.id,
                changes: { name: "Admin Updated" }
            });

            expect(result.ok).toBe(true);
        });
    });

    describe("delete", () => {
        it("should delete a timelapse owned by user", async () => {
            const user = testFactory.user();
            const mockTimelapse = testFactory.timelapse({ ownerId: user.id, isPublished: true });

            mockDatabase.timelapse.findFirst.mockResolvedValue(mockTimelapse);
            mockDatabase.snapshot.deleteMany.mockResolvedValue({ count: 5 });
            mockDatabase.timelapse.delete.mockResolvedValue(mockTimelapse);

            const caller = createCaller(createMockContext(user));
            const result = await caller.delete({ id: mockTimelapse.id });

            expect(result.ok).toBe(true);
            expect(mockDatabase.timelapse.delete).toHaveBeenCalledWith({
                where: { id: mockTimelapse.id }
            });

            expect(mockS3Send).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: expect.objectContaining({
                        Bucket: expect.any(String),
                        Key: mockTimelapse.s3Key
                    })
                })
            );
            expect(mockS3Send).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: expect.objectContaining({
                        Bucket: expect.any(String),
                        Key: mockTimelapse.thumbnailS3Key
                    })
                })
            );
        });

        it("should allow admin to delete any timelapse", async () => {
            const owner = testFactory.user();
            const admin = testFactory.user({ permissionLevel: "ADMIN" });
            const mockTimelapse = testFactory.timelapse({ ownerId: owner.id, isPublished: true });

            mockDatabase.timelapse.findFirst.mockResolvedValue(mockTimelapse);
            mockDatabase.snapshot.deleteMany.mockResolvedValue({ count: 0 });
            mockDatabase.timelapse.delete.mockResolvedValue(mockTimelapse);

            const caller = createCaller(createMockContext(admin));
            const result = await caller.delete({ id: mockTimelapse.id });

            expect(result.ok).toBe(true);
            expect(mockDatabase.timelapse.delete).toHaveBeenCalledWith({
                where: { id: mockTimelapse.id }
            });
            
            expect(mockS3Send).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: expect.objectContaining({
                        Bucket: expect.any(String),
                        Key: mockTimelapse.s3Key
                    })
                })
            );
            expect(mockS3Send).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: expect.objectContaining({
                        Bucket: expect.any(String),
                        Key: mockTimelapse.thumbnailS3Key
                    })
                })
            );
        });
    });

    describe("findByUser", () => {
        it("should return public published timelapses for anonymous users", async () => {
            const owner = testFactory.user();
            const mockTimelapse = testFactory.timelapse({ ownerId: owner.id, isPublished: true, visibility: "PUBLIC" });

            mockDatabase.timelapse.findMany.mockResolvedValue([{
                ...mockTimelapse,
                owner,
                device: null,
                comments: []
            }]);

            const caller = createCaller(createMockContext(null));
            const result = await caller.findByUser({ user: owner.id });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapses).toHaveLength(1);
                expect(result.data.timelapses[0].id).toBe(mockTimelapse.id);
            }
        });

        it("should return all timelapses including unpublished for owner", async () => {
            const owner = testFactory.user();
            const publishedTimelapse = testFactory.timelapse({ ownerId: owner.id, isPublished: true });
            const unpublishedTimelapse = testFactory.timelapse({ ownerId: owner.id, isPublished: false });

            mockDatabase.timelapse.findMany.mockResolvedValue([
                { ...publishedTimelapse, owner, device: null, comments: [] },
                { ...unpublishedTimelapse, owner, device: null, comments: [] }
            ]);

            const caller = createCaller(createMockContext(owner));
            const result = await caller.findByUser({ user: owner.id });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapses).toHaveLength(2);
            }
        });

        it("should include private data for owned timelapses", async () => {
            const owner = testFactory.user();
            const device = testFactory.device({ ownerId: owner.id });
            const mockTimelapse = testFactory.timelapse({ ownerId: owner.id, deviceId: device.id });

            mockDatabase.timelapse.findMany.mockResolvedValue([{
                ...mockTimelapse,
                owner,
                device,
                comments: []
            }]);

            const caller = createCaller(createMockContext(owner));
            const result = await caller.findByUser({ user: owner.id });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapses[0].private).toBeDefined();
            }
        });
    });

    describe("publish", () => {
        it("should return NOT_FOUND when timelapse does not exist", async () => {
            const user = testFactory.user();
            mockDatabase.timelapse.findFirst.mockResolvedValue(null);

            const caller = createCaller(createMockContext(user));
            const result = await caller.publish({
                id: "non-existent",
                passkey: "123456",
                visibility: "PUBLIC"
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NOT_FOUND");
            }
        });

        it("should return NO_PERMISSION when user does not own timelapse", async () => {
            const owner = testFactory.user();
            const otherUser = testFactory.user();
            const mockTimelapse = testFactory.timelapse({ ownerId: owner.id, isPublished: false });

            mockDatabase.timelapse.findFirst.mockResolvedValue(mockTimelapse);

            const caller = createCaller(createMockContext(otherUser));
            const result = await caller.publish({
                id: mockTimelapse.id,
                passkey: "123456",
                visibility: "PUBLIC"
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NO_PERMISSION");
            }
        });

        it("should return ALREADY_PUBLISHED when timelapse is already published", async () => {
            const user = testFactory.user();
            const mockTimelapse = testFactory.timelapse({ ownerId: user.id, isPublished: true });

            mockDatabase.timelapse.findFirst.mockResolvedValue(mockTimelapse);

            const caller = createCaller(createMockContext(user));
            const result = await caller.publish({
                id: mockTimelapse.id,
                passkey: "123456",
                visibility: "PUBLIC"
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("ALREADY_PUBLISHED");
            }
        });

        it("should publish an unpublished timelapse", async () => {
            const user = testFactory.user();
            const mockTimelapse = testFactory.timelapse({ ownerId: user.id, isPublished: false });
            
            mockDatabase.timelapse.findFirst.mockResolvedValue(mockTimelapse);
            mockDatabase.timelapse.update.mockResolvedValue({
                ...mockTimelapse,
                isPublished: true,
                visibility: "PUBLIC",
                owner: user,
                device: null,
                comments: []
            });

            mockS3Send.mockResolvedValueOnce({
                Body: {
                    transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3]))
                }
            });
            mockDecryptVideo.mockReturnValueOnce(Buffer.from([1, 2, 3]));
            mockGenerateThumbnail.mockResolvedValueOnce(Buffer.from([4, 5, 6]));

            const caller = createCaller(createMockContext(user));
            const result = await caller.publish({
                id: mockTimelapse.id,
                passkey: "123456",
                visibility: "PUBLIC"
            });
            
            mockS3Send.mockResolvedValueOnce({
                Body: {
                    transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3]))
                }
            });


            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapse.isPublished).toBe(true);
                expect(result.data.timelapse.visibility).toBe("PUBLIC");
            }
        });
    });

    describe("syncWithHackatime", () => {
        it("should return NOT_FOUND when timelapse does not exist", async () => {
            const user = testFactory.user();
            mockDatabase.timelapse.findFirst.mockResolvedValue(null);

            const caller = createCaller(createMockContext(user));
            const result = await caller.syncWithHackatime({
                id: "non-existent",
                hackatimeProject: "my-project"
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NOT_FOUND");
            }
        });

        it("should return HACKATIME_ERROR when timelapse already has a project", async () => {
            const user = testFactory.user({ slackId: "U123456" });
            const mockTimelapse = testFactory.timelapse({ 
                ownerId: user.id, 
                hackatimeProject: "existing-project" 
            });

            mockDatabase.timelapse.findFirst.mockResolvedValue({
                ...mockTimelapse,
                owner: user
            });

            const caller = createCaller(createMockContext(user));
            const result = await caller.syncWithHackatime({
                id: mockTimelapse.id,
                hackatimeProject: "new-project"
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("HACKATIME_ERROR");
            }
        });

        it("should return ERROR when user has no linked Slack account", async () => {
            const user = testFactory.user({ slackId: null });
            const mockTimelapse = testFactory.timelapse({ ownerId: user.id, hackatimeProject: null });

            mockDatabase.timelapse.findFirst.mockResolvedValue({
                ...mockTimelapse,
                owner: user
            });

            const caller = createCaller(createMockContext(user));
            const result = await caller.syncWithHackatime({
                id: mockTimelapse.id,
                hackatimeProject: "my-project"
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("ERROR");
                expect(result.message).toContain("Slack");
            }
        });

        it("should sync timelapse with Hackatime", async () => {
            const user = testFactory.user({ slackId: "U123456" });
            const mockTimelapse = testFactory.timelapse({ ownerId: user.id, hackatimeProject: null });
            const snapshots = [
                testFactory.snapshot({ timelapseId: mockTimelapse.id, createdAt: new Date("2026-01-05T00:00:00.000Z") }),
                testFactory.snapshot({ timelapseId: mockTimelapse.id, createdAt: new Date("2026-01-05T00:00:10.000Z") }),
            ];
            
            mockDatabase.timelapse.findFirst.mockResolvedValue({
                ...mockTimelapse,
                owner: user
            });
            mockDatabase.timelapse.update.mockResolvedValue({
                ...mockTimelapse,
                hackatimeProject: "my-project",
                owner: user,
                device: null,
                comments: []
            });

            mockDatabase.snapshot.findMany.mockResolvedValue(snapshots);
            mockDatabase.snapshot.update.mockResolvedValue(snapshots[0]);

            vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    responses: [
                        [{ id: 1, time: snapshots[0]!.createdAt.getTime() / 1000 }, 201],
                        [{ id: 2, time: snapshots[1]!.createdAt.getTime() / 1000 }, 201],
                    ]
                })
            }));
            
            const caller = createCaller(createMockContext(user));
            const result = await caller.syncWithHackatime({
                id: mockTimelapse.id,
                hackatimeProject: "my-project"
            });
            
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapse.id).toBe(mockTimelapse.id);
                expect(result.data.timelapse.private?.hackatimeProject).toBe("my-project");
            }
        });
    });
});