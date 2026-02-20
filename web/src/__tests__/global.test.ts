import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { setupDatabaseMock, mockDatabase, resetMockDatabase } from "@/__tests__/mocks/database";
import { createMockContext } from "@/__tests__/mocks/trpc";
import { testFactory } from "@/__tests__/factories";
import { setupEnvMock } from "@/__tests__/mocks/env";
import { setupS3Mock } from "@/__tests__/mocks/s3";
import { setupServerCommonMock } from "@/__tests__/mocks/serverCommon";

setupDatabaseMock();

setupServerCommonMock();
setupEnvMock();
setupS3Mock();

const importRouter = async () => (await import("@/server/routers/api/global")).default;

const createCaller = async (ctx: ReturnType<typeof createMockContext>) =>
    (await importRouter()).createCaller(ctx);

describe("global router", () => {
    beforeEach(() => {
        resetMockDatabase();
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-04T12:00:00.000Z"));
        vi.resetModules();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("weeklyLeaderboard", () => {
        it("should return users sorted by summed duration", async () => {
            const u1 = testFactory.user({
                id: "user-1",
                handle: "user1",
                displayName: "User One",
                profilePictureUrl: "https://example.com/u1.png",
            });
            const u2 = testFactory.user({
                id: "user-2",
                handle: "user2",
                displayName: "User Two",
                profilePictureUrl: "https://example.com/u2.png",
            });
            const u3 = testFactory.user({
                id: "user-3",
                handle: "user3",
                displayName: "User Three",
                profilePictureUrl: "https://example.com/u3.png",
            });

            mockDatabase.timelapse.groupBy.mockResolvedValue([
                { ownerId: u1.id, _sum: { duration: 50 } },
                { ownerId: u2.id, _sum: { duration: 120 } },
                { ownerId: u3.id, _sum: { duration: null } },
            ]);

            mockDatabase.user.findMany.mockResolvedValue([
                {
                    id: u1.id,
                    handle: u1.handle,
                    displayName: u1.displayName,
                    profilePictureUrl: u1.profilePictureUrl,
                },
                {
                    id: u2.id,
                    handle: u2.handle,
                    displayName: u2.displayName,
                    profilePictureUrl: u2.profilePictureUrl,
                },
                {
                    id: u3.id,
                    handle: u3.handle,
                    displayName: u3.displayName,
                    profilePictureUrl: u3.profilePictureUrl,
                },
            ]);

            const caller = await createCaller(createMockContext(null));
            const result = await caller.weeklyLeaderboard({});

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.leaderboard).toHaveLength(2);
                expect(result.data.leaderboard[0]?.id).toBe(u2.id);
                expect(result.data.leaderboard[0]?.secondsThisWeek).toBe(120);
                expect(result.data.leaderboard[1]?.id).toBe(u1.id);
                expect(result.data.leaderboard[1]?.secondsThisWeek).toBe(50);
            }

            expect(mockDatabase.timelapse.groupBy).toHaveBeenCalledWith(
                expect.objectContaining({
                    by: ["ownerId"],
                    take: 10,
                    _sum: { duration: true },
                    orderBy: { _sum: { duration: "desc" } },
                    where: expect.objectContaining({
                        createdAt: expect.objectContaining({
                            gte: expect.any(Date),
                        }),
                    }),
                })
            );
        });

        it("should use cached results for repeated calls on the same day", async () => {
            const user = testFactory.user({
                id: "user-1",
                handle: "user1",
                displayName: "User One",
                profilePictureUrl: "https://example.com/u1.png",
            });

            mockDatabase.timelapse.groupBy.mockResolvedValue([
                { ownerId: user.id, _sum: { duration: 5 } },
            ]);

            mockDatabase.user.findMany.mockResolvedValue([
                {
                    id: user.id,
                    handle: user.handle,
                    displayName: user.displayName,
                    profilePictureUrl: user.profilePictureUrl,
                },
            ]);

            const caller = await createCaller(createMockContext(null));

            const first = await caller.weeklyLeaderboard({});
            const second = await caller.weeklyLeaderboard({});

            expect(first.ok).toBe(true);
            expect(second.ok).toBe(true);

            expect(mockDatabase.timelapse.groupBy).toHaveBeenCalledTimes(1);
            expect(mockDatabase.user.findMany).toHaveBeenCalledTimes(1);
        });
    });

    describe("recentTimelapses", () => {
        it("should return the most recent public timelapses", async () => {
            const owner = testFactory.user({
                id: "owner-1",
                handle: "owner",
                displayName: "Owner",
                profilePictureUrl: "https://example.com/owner.png",
            });
            const author = testFactory.user({
                id: "commenter-1",
                handle: "commenter",
                displayName: "Commenter",
                profilePictureUrl: "https://example.com/commenter.png",
            });
            const comment = testFactory.comment({
                id: "comment-1",
                authorId: author.id,
                timelapseId: "tl-1",
            });
            const timelapse = testFactory.timelapse({
                id: "tl-1",
                ownerId: owner.id,
                isPublished: true,
                visibility: "PUBLIC",
                s3Key: "timelapses/tl-1.webm",
                thumbnailS3Key: "thumbnails/tl-1.jpg",
            });

            mockDatabase.timelapse.findMany.mockResolvedValue([
                {
                    ...timelapse,
                    owner,
                    comments: [
                        {
                            ...comment,
                            author,
                        },
                    ],
                },
            ]);

            const caller = await createCaller(createMockContext(null));
            const result = await caller.recentTimelapses({});

            expect(mockDatabase.timelapse.findMany).toHaveBeenCalledWith({
                where: { isPublished: true, visibility: "PUBLIC" },
                orderBy: { createdAt: "desc" },
                include: {
                    owner: true,
                    comments: { include: { author: true } },
                },
                take: 50,
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.timelapses).toHaveLength(1);
                const dto = result.data.timelapses[0];
                expect(dto?.id).toBe(timelapse.id);
                expect(dto?.playbackUrl).toBe(`https://public.example.com/${timelapse.s3Key}`);
                expect(dto?.thumbnailUrl).toBe(`https://public.example.com/${timelapse.thumbnailS3Key}`);
                expect(dto?.comments).toHaveLength(1);
                expect(dto?.comments[0]?.id).toBe(comment.id);
                expect(dto?.comments[0]?.author.id).toBe(author.id);
            }
        });
    });

    describe("activeUsers", () => {
        it("should return the count of users with a heartbeat in the last 60 seconds", async () => {
            mockDatabase.user.aggregate.mockResolvedValue({
                _count: { lastHeartbeat: 7 },
            });

            const caller = await createCaller(createMockContext(null));
            const result = await caller.activeUsers({});

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.count).toBe(7);
            }

            const args = mockDatabase.user.aggregate.mock.calls[0]?.[0] as unknown as {
                _count: { lastHeartbeat: true };
                where: { lastHeartbeat: { gt: Date } };
            };

            expect(args._count).toEqual({ lastHeartbeat: true });

            const now = new Date("2026-01-04T12:00:00.000Z");
            expect(args.where.lastHeartbeat.gt.getTime()).toBe(now.getTime() - 60_000);
        });
    });
});
