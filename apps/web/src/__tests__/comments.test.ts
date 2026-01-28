import { describe, it, expect, beforeEach, vi } from "vitest";

import { setupDatabaseMock, mockDatabase, resetMockDatabase } from "@/__tests__/mocks/database";
import { createMockContext, createUnauthenticatedContext } from "@/__tests__/mocks/trpc";
import { setupServerCommonMock, serverCommonMocks } from "@/__tests__/mocks/serverCommon";
import { testFactory } from "@/__tests__/factories";
import { Err } from "@/shared/common";

import type { Result } from "@/shared/common";
import type { Actor } from "@/server/routers/common";
import type { OwnedTimelapse, Timelapse } from "@/server/routers/api/timelapse";
import type { Comment as DbComment, User } from "@/generated/prisma/client";

type GetTimelapseByIdMockFn = (id: string, actor: Actor) => Promise<Result<Timelapse | OwnedTimelapse>>;

const getTimelapseByIdMock = vi.hoisted(() => vi.fn<GetTimelapseByIdMockFn>());
const deleteTimelapseMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/routers/api/timelapse", () => ({
    getTimelapseById: getTimelapseByIdMock,
    deleteTimelapse: deleteTimelapseMock,
}));

setupDatabaseMock();
setupServerCommonMock();

import comment from "@/server/routers/api/comment";

const createCaller = (ctx: ReturnType<typeof createMockContext>) => comment.createCaller(ctx);

describe("comment router", () => {
    beforeEach(() => {
        resetMockDatabase();
        getTimelapseByIdMock.mockReset();
        serverCommonMocks.logRequest.mockReset();
    });

    describe("create", () => {
        it("requires authentication", async () => {
            const caller = createCaller(createUnauthenticatedContext());

            await expect(
                caller.create({
                    id: "timelapse-id",
                    content: "hello",
                })
            ).rejects.toMatchObject({
                code: "UNAUTHORIZED",
            });
        });

        it("rejects invalid input", async () => {
            const caller = createCaller(createMockContext(testFactory.user()));

            await expect(
                caller.create({
                    id: "timelapse-id",
                    content: "",
                })
            ).rejects.toMatchObject({
                code: "BAD_REQUEST",
            });
        });

        it("returns timelapse error when timelapse lookup fails", async () => {
            const user = testFactory.user();
            getTimelapseByIdMock.mockResolvedValueOnce(new Err("NOT_FOUND", "Couldn't find that timelapse!"));

            const caller = createCaller(createMockContext(user));
            const result = await caller.create({
                id: "missing-timelapse-id",
                content: "hello",
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NOT_FOUND");
            }

            expect(mockDatabase.comment.create).not.toHaveBeenCalled();
        });

        it("returns ERROR when timelapse is not published", async () => {
            const user = testFactory.user();
            getTimelapseByIdMock.mockResolvedValueOnce({
                isPublished: false,
            } as unknown as Timelapse);

            const caller = createCaller(createMockContext(user));
            const result = await caller.create({
                id: "timelapse-id",
                content: "hello",
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("ERROR");
            }

            expect(mockDatabase.comment.create).not.toHaveBeenCalled();
        });

        it("creates a comment and returns DTO", async () => {
            const user = testFactory.user({ id: "user-1" });
            const timelapseId = "timelapse-1";

            getTimelapseByIdMock.mockResolvedValueOnce({
                isPublished: true,
            } as unknown as Timelapse);

            const dbComment: DbComment & { author: User } = {
                ...testFactory.comment({
                    id: "comment-1",
                    authorId: user.id,
                    timelapseId,
                    content: "Hello world",
                    createdAt: new Date("2026-01-04T12:00:00.000Z"),
                }),
                author: user,
            };

            mockDatabase.comment.create.mockResolvedValueOnce(dbComment);

            const caller = createCaller(createMockContext(user));
            const result = await caller.create({
                id: timelapseId,
                content: "Hello world",
            });

            expect(serverCommonMocks.logRequest).toHaveBeenCalledWith(
                "comment/create",
                expect.any(Object)
            );

            expect(mockDatabase.comment.create).toHaveBeenCalledWith({
                data: {
                    authorId: user.id,
                    timelapseId,
                    content: "Hello world",
                },
                include: { author: true },
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.comment.id).toBe("comment-1");
                expect(result.data.comment.content).toBe("Hello world");
                expect(result.data.comment.author.id).toBe(user.id);
                expect(result.data.comment.createdAt).toBe(new Date("2026-01-04T12:00:00.000Z").getTime());
            }
        });
    });

    describe("delete", () => {
        it("requires authentication", async () => {
            const caller = createCaller(createUnauthenticatedContext());

            await expect(
                caller.delete({
                    commentId: "comment-id",
                })
            ).rejects.toMatchObject({
                code: "UNAUTHORIZED",
            });
        });

        it("returns NOT_FOUND when comment does not exist", async () => {
            const user = testFactory.user();
            mockDatabase.comment.findUnique.mockResolvedValueOnce(null);

            const caller = createCaller(createMockContext(user));
            const result = await caller.delete({ commentId: "missing-comment" });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NOT_FOUND");
            }

            expect(mockDatabase.comment.delete).not.toHaveBeenCalled();
        });

        it("returns NO_PERMISSION when deleting another user's comment", async () => {
            const user = testFactory.user({ id: "user-1" });
            const other = testFactory.user({ id: "user-2" });
            const timelapse = testFactory.timelapse({ id: "timelapse-1", ownerId: "owner-1" });
            const commentEntity = testFactory.comment({
                id: "comment-1",
                authorId: other.id,
                timelapseId: timelapse.id,
            });

            mockDatabase.comment.findUnique.mockResolvedValueOnce({
                ...commentEntity,
                timelapse,
            });

            const caller = createCaller(createMockContext(user));
            const result = await caller.delete({ commentId: commentEntity.id });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("NO_PERMISSION");
            }
            expect(mockDatabase.comment.delete).not.toHaveBeenCalled();
        });

        it("allows admin to delete any comment", async () => {
            const admin = testFactory.user({ id: "admin-1", permissionLevel: "ADMIN" });
            const other = testFactory.user({ id: "user-2" });
            const timelapse = testFactory.timelapse({ id: "timelapse-1", ownerId: "owner-1" });
            const commentEntity = testFactory.comment({
                id: "comment-1",
                authorId: other.id,
                timelapseId: timelapse.id,
            });

            mockDatabase.comment.findUnique.mockResolvedValueOnce({
                ...commentEntity,
                timelapse,
            });
            mockDatabase.comment.delete.mockResolvedValueOnce(commentEntity);

            const caller = createCaller(createMockContext(admin));
            const result = await caller.delete({ commentId: commentEntity.id });

            expect(result.ok).toBe(true);
            expect(mockDatabase.comment.delete).toHaveBeenCalledWith({
                where: { id: commentEntity.id },
            });
        });

        it("allows timelapse owner to delete comments on their timelapse", async () => {
            const owner = testFactory.user({ id: "owner-1" });
            const commenter = testFactory.user({ id: "user-2" });
            const timelapse = testFactory.timelapse({ id: "timelapse-1", ownerId: owner.id });
            const commentEntity = testFactory.comment({
                id: "comment-1",
                authorId: commenter.id,
                timelapseId: timelapse.id,
            });

            mockDatabase.comment.findUnique.mockResolvedValueOnce({
                ...commentEntity,
                timelapse,
            });
            mockDatabase.comment.delete.mockResolvedValueOnce(commentEntity);

            const caller = createCaller(createMockContext(owner));
            const result = await caller.delete({ commentId: commentEntity.id });

            expect(result.ok).toBe(true);
            expect(mockDatabase.comment.delete).toHaveBeenCalledWith({
                where: { id: commentEntity.id },
            });
        });

        it("deletes owned comment", async () => {
            const user = testFactory.user({ id: "user-1" });
            const timelapse = testFactory.timelapse({ id: "timelapse-1", ownerId: "owner-1" });
            const commentEntity = testFactory.comment({
                id: "comment-1",
                authorId: user.id,
                timelapseId: timelapse.id,
            });

            mockDatabase.comment.findUnique.mockResolvedValueOnce({
                ...commentEntity,
                timelapse,
            });
            mockDatabase.comment.delete.mockResolvedValueOnce(commentEntity);

            const caller = createCaller(createMockContext(user));
            const result = await caller.delete({ commentId: commentEntity.id });

            expect(serverCommonMocks.logRequest).toHaveBeenCalledWith(
                "comment/delete",
                expect.any(Object)
            );

            expect(mockDatabase.comment.delete).toHaveBeenCalledWith({
                where: { id: commentEntity.id },
            });

            expect(result.ok).toBe(true);
        });
    });
});