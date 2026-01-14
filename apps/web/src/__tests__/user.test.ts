import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

import { setupDatabaseMock, mockDatabase, resetMockDatabase } from "@/__tests__/mocks/database";
import { createMockContext } from "@/__tests__/mocks/trpc";
import { setupServerCommonMock } from "@/__tests__/mocks/serverCommon";
import { testFactory } from "@/__tests__/factories";

setupDatabaseMock();
setupServerCommonMock();

const deleteTimelapseMock = vi.fn();

vi.mock("@/server/routers/api/timelapse", () => ({
	deleteTimelapse: deleteTimelapseMock,
}));

type Context = ReturnType<typeof createMockContext>;

function polyfillIteratorHelpers(): void {
	const mapIterator = <T, U>(
		iterator: Iterable<T>,
		mapFn: (value: T, index: number) => U
	): { toArray: () => U[]; [Symbol.iterator]: () => Iterator<U> } => {
		const mapped = {
			*[Symbol.iterator](): Iterator<U> {
				let index = 0;
				for (const value of iterator) {
					yield mapFn(value, index);
					index++;
				}
			},
			toArray(): U[] {
				return Array.from(mapped);
			},
		};

		return mapped;
	};

	const mapIteratorPrototype = Object.getPrototypeOf(new Map().entries()) as Record<string, unknown>;

	if (typeof (mapIteratorPrototype as { map?: unknown }).map !== "function") {
		(mapIteratorPrototype as {
			map: <T, U>(this: Iterable<T>, mapFn: (value: T, index: number) => U) => {
				toArray: () => U[];
				[Symbol.iterator]: () => Iterator<U>;
			};
		}).map = function <T, U>(this: Iterable<T>, mapFn: (value: T, index: number) => U) {
			return mapIterator(this, mapFn);
		};
	}
}

const importRouter = async () => (await import("@/server/routers/api/user")).default;

const createCaller = async (ctx: Context) =>
	(await importRouter()).createCaller(ctx);

describe("user router", () => {
	beforeAll(() => {
		polyfillIteratorHelpers();
	});

	beforeEach(() => {
		resetMockDatabase();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-04T12:00:00.000Z"));
		vi.resetModules();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("myself", () => {
		it("should return null for anonymous users", async () => {
			const caller = await createCaller(createMockContext(null));
			const result = await caller.myself({});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.user).toBeNull();
			}
			expect(mockDatabase.user.findFirst).not.toHaveBeenCalled();
		});

		it("should return NOT_FOUND when authenticated user is missing", async () => {
			const user = testFactory.user();
			mockDatabase.user.findFirst.mockResolvedValue(null);

			const caller = await createCaller(createMockContext(user));
			const result = await caller.myself({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("NOT_FOUND");
			}
		});

		it("should return user with private fields when authenticated", async () => {
			const user = testFactory.user({ id: "user-1", handle: "user1" });
			const device = testFactory.device({ ownerId: user.id, name: "My Device" });

			mockDatabase.user.findFirst.mockResolvedValue({
				...user,
				devices: [device],
			});

			const caller = await createCaller(createMockContext(user));
			const result = await caller.myself({});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.user?.id).toBe(user.id);
				expect(result.data.user?.private.permissionLevel).toBe(user.permissionLevel);
				expect(result.data.user?.private.devices).toEqual([
					{
						id: device.id,
						name: device.name,
					},
				]);
			}
		});
	});

	describe("query", () => {
		it("should return MISSING_PARAMS when neither handle nor id is set", async () => {
			const caller = await createCaller(createMockContext(null));
			const result = await caller.query({});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("MISSING_PARAMS");
			}
		});

		it("should return null when no user is found", async () => {
			mockDatabase.user.findFirst.mockResolvedValue(null);
			const caller = await createCaller(createMockContext(null));
			const result = await caller.query({ handle: "someone" });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.user).toBeNull();
			}
		});

		it("should trim handle and return a public user for non-owner", async () => {
			const target = testFactory.user({ id: "user-1", handle: "target" });
			mockDatabase.user.findFirst.mockResolvedValue({
				...target,
				devices: [],
			});

			const caller = await createCaller(createMockContext(null));
			const result = await caller.query({ handle: "  target  " });

			expect(mockDatabase.user.findFirst).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { handle: "target" },
					include: { devices: true },
				})
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.user?.id).toBe(target.id);
				expect((result.data.user as { private?: unknown }).private).toBeUndefined();
			}
		});

		it("should return a user with private fields for owner", async () => {
			const owner = testFactory.user({ id: "owner-1", handle: "owner" });
			const device = testFactory.device({ ownerId: owner.id });
			mockDatabase.user.findFirst.mockResolvedValue({
				...owner,
				devices: [device],
			});

			const caller = await createCaller(createMockContext(owner));
			const result = await caller.query({ id: owner.id });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.user?.id).toBe(owner.id);
				expect((result.data.user as { private?: unknown }).private).toBeDefined();
			}
		});
	});

	describe("update", () => {
		it("should deny normal users editing other profiles", async () => {
			const user = testFactory.user({ id: "user-1", permissionLevel: "USER" });
			const other = testFactory.user({ id: "user-2" });

			const caller = await createCaller(createMockContext(user));
			const result = await caller.update({
				id: other.id,
				changes: { displayName: "New Name" },
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("NO_PERMISSION");
			}
			expect(mockDatabase.user.update).not.toHaveBeenCalled();
		});

		it("should update provided fields and return updated user", async () => {
			const admin = testFactory.user({ id: "admin-1", permissionLevel: "ADMIN" });
			const target = testFactory.user({ id: "user-2", handle: "user2" });
			const updated = {
				...target,
				displayName: "Updated Display",
				devices: [testFactory.device({ ownerId: target.id })],
			};

			mockDatabase.user.update.mockResolvedValue(updated);

			const caller = await createCaller(createMockContext(admin));
			const result = await caller.update({
				id: target.id,
				changes: { displayName: "Updated Display" },
			});

			expect(mockDatabase.user.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: target.id },
					data: expect.objectContaining({
						displayName: "Updated Display",
					}),
					include: { devices: true },
				})
			);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.user.id).toBe(target.id);
				expect(result.data.user.displayName).toBe("Updated Display");
			}
		});
	});

	describe("devices", () => {
		it("should list registered devices", async () => {
			const user = testFactory.user({ id: "user-1" });
			const devices = [
				testFactory.device({ ownerId: user.id, name: "Device 1" }),
				testFactory.device({ ownerId: user.id, name: "Device 2" }),
			];

			mockDatabase.knownDevice.findMany.mockResolvedValue(devices);

			const caller = await createCaller(createMockContext(user));
			const result = await caller.getDevices({});

			expect(mockDatabase.knownDevice.findMany).toHaveBeenCalledWith({
				where: { ownerId: user.id },
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.devices).toEqual(
					devices.map((d) => ({
						id: d.id,
						name: d.name,
					}))
				);
			}
		});

		it("should register a new device", async () => {
			const user = testFactory.user({ id: "user-1" });
			const device = testFactory.device({ ownerId: user.id, name: "My Phone" });

			mockDatabase.knownDevice.create.mockResolvedValue(device);

			const caller = await createCaller(createMockContext(user));
			const result = await caller.registerDevice({ name: "My Phone" });

			expect(mockDatabase.knownDevice.create).toHaveBeenCalledWith({
				data: { name: "My Phone", ownerId: user.id },
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.device).toEqual({ id: device.id, name: device.name });
			}
		});

		it("should return DEVICE_NOT_FOUND when removing missing device", async () => {
			const user = testFactory.user({ id: "user-1" });
			mockDatabase.knownDevice.findFirst.mockResolvedValue(null);

			const caller = await createCaller(createMockContext(user));
			const result = await caller.removeDevice({ id: "dev-missing" });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("DEVICE_NOT_FOUND");
			}
		});

		it("should block device removal if referenced by another owner", async () => {
			const user = testFactory.user({ id: "user-1" });
			const device = testFactory.device({ ownerId: user.id });
			const foreignTimelapse = testFactory.timelapse({ id: "tl-1", ownerId: "someone-else", deviceId: device.id });

			mockDatabase.knownDevice.findFirst.mockResolvedValue(device);
			mockDatabase.timelapse.findMany.mockResolvedValue([foreignTimelapse]);

			const caller = await createCaller(createMockContext(user));
			const result = await caller.removeDevice({ id: device.id });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("ERROR");
			}

			expect(deleteTimelapseMock).not.toHaveBeenCalled();
			expect(mockDatabase.knownDevice.delete).not.toHaveBeenCalled();
		});

		it("should delete device and associated timelapses", async () => {
			const user = testFactory.user({ id: "user-1" });
			const device = testFactory.device({ ownerId: user.id });
			const t1 = testFactory.timelapse({ id: "tl-1", ownerId: user.id, deviceId: device.id });
			const t2 = testFactory.timelapse({ id: "tl-2", ownerId: user.id, deviceId: device.id });

			mockDatabase.knownDevice.findFirst.mockResolvedValue(device);
			mockDatabase.timelapse.findMany.mockResolvedValue([t1, t2]);
			deleteTimelapseMock.mockResolvedValue(undefined);
			mockDatabase.knownDevice.delete.mockResolvedValue(device);

			const caller = await createCaller(createMockContext(user));
			const result = await caller.removeDevice({ id: device.id });

			expect(result.ok).toBe(true);
			expect(deleteTimelapseMock).toHaveBeenCalledTimes(2);
			expect(deleteTimelapseMock).toHaveBeenCalledWith(t1.id, user);
			expect(deleteTimelapseMock).toHaveBeenCalledWith(t2.id, user);
			expect(mockDatabase.knownDevice.delete).toHaveBeenCalledWith({
				where: { id: device.id, ownerId: user.id },
			});
		});
	});

	describe("signOut", () => {
		it("should clear auth cookie", async () => {
			const ctx = createMockContext(null);
			const caller = await createCaller(ctx);
			const result = await caller.signOut({});

			expect(result.ok).toBe(true);
			expect(ctx.res.setHeader).toHaveBeenCalledWith(
				"Set-Cookie",
				expect.arrayContaining([
					expect.stringContaining("lapse-auth="),
				])
			);
		});
	});

	describe("hackatimeProjects", () => {
		it("should aggregate durations by project and sort descending", async () => {
			const user = testFactory.user({ id: "user-1" });
			mockDatabase.timelapse.findMany.mockResolvedValue([
				{ hackatimeProject: "A", duration: 10 },
				{ hackatimeProject: "B", duration: 5 },
				{ hackatimeProject: "A", duration: 20 },
			]);

			const caller = await createCaller(createMockContext(user));
			const result = await caller.hackatimeProjects({});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.projects).toEqual([
					{ name: "A", time: 30 },
					{ name: "B", time: 5 },
				]);
			}
		});
	});

	describe("getTotalTimelapseTime", () => {
		it("should require id when unauthenticated", async () => {
			const caller = await createCaller(createMockContext(null));
			const result = await caller.getTotalTimelapseTime({ id: null });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("MISSING_PARAMS");
			}
		});

		it("should return 0 when sum is null", async () => {
			const user = testFactory.user({ id: "user-1" });
			mockDatabase.timelapse.aggregate.mockResolvedValue({ _sum: { duration: null } });

			const caller = await createCaller(createMockContext(user));
			const result = await caller.getTotalTimelapseTime({ id: null });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.time).toBe(0);
			}
		});

		it("should return summed duration for authenticated user when id is null", async () => {
			const user = testFactory.user({ id: "user-1" });
			mockDatabase.timelapse.aggregate.mockResolvedValue({ _sum: { duration: 30 } });

			const caller = await createCaller(createMockContext(user));
			const result = await caller.getTotalTimelapseTime({ id: null });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.time).toBe(30);
			}
		});
	});

	describe("emitHeartbeat", () => {
		it("should update lastHeartbeat to current date", async () => {
			const user = testFactory.user({ id: "user-1" });
			mockDatabase.user.update.mockResolvedValue(user);

			const caller = await createCaller(createMockContext(user));
			const result = await caller.emitHeartbeat({});

			expect(result.ok).toBe(true);
			expect(mockDatabase.user.update).toHaveBeenCalledWith({
				data: { lastHeartbeat: new Date("2026-01-04T12:00:00.000Z") },
				where: { id: user.id },
			});
		});
	});

	describe("setBanStatus", () => {
		it("should deny normal users from banning", async () => {
			const user = testFactory.user({ id: "user-1", permissionLevel: "USER" });
			const target = testFactory.user({ id: "user-2", permissionLevel: "USER" });

			const caller = await createCaller(createMockContext(user));
			const result = await caller.setBanStatus({
				id: target.id,
				isBanned: true,
				reason: "Test ban",
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("NO_PERMISSION");
			}
		});

		it("should allow admin to ban a user", async () => {
			const admin = testFactory.user({ id: "admin-1", permissionLevel: "ADMIN" });
			const target = testFactory.user({ id: "user-1", permissionLevel: "USER" });
			const bannedTarget = {
				...target,
				isBanned: true,
				bannedAt: new Date(),
				bannedReason: "Test ban",
				devices: [],
			};

			mockDatabase.user.findFirst.mockResolvedValue({ ...target, devices: [] });
			mockDatabase.user.update.mockResolvedValue(bannedTarget);

			const caller = await createCaller(createMockContext(admin));
			const result = await caller.setBanStatus({
				id: target.id,
				isBanned: true,
				reason: "Test ban",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.user.private.isBanned).toBe(true);
			}
		});

		it("should prevent admin from banning another admin", async () => {
			const admin1 = testFactory.user({ id: "admin-1", permissionLevel: "ADMIN" });
			const admin2 = testFactory.user({ id: "admin-2", permissionLevel: "ADMIN" });

			mockDatabase.user.findFirst.mockResolvedValue({ ...admin2, devices: [] });

			const caller = await createCaller(createMockContext(admin1));
			const result = await caller.setBanStatus({
				id: admin2.id,
				isBanned: true,
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("NO_PERMISSION");
			}
		});

		it("should allow ROOT to ban an admin", async () => {
			const root = testFactory.user({ id: "root-1", permissionLevel: "ROOT" });
			const admin = testFactory.user({ id: "admin-1", permissionLevel: "ADMIN" });
			const bannedAdmin = {
				...admin,
				isBanned: true,
				bannedAt: new Date(),
				bannedReason: "Test ban",
				devices: [],
			};

			mockDatabase.user.findFirst.mockResolvedValue({ ...admin, devices: [] });
			mockDatabase.user.update.mockResolvedValue(bannedAdmin);

			const caller = await createCaller(createMockContext(root));
			const result = await caller.setBanStatus({
				id: admin.id,
				isBanned: true,
				reason: "Test ban",
			});

			expect(result.ok).toBe(true);
		});

		it("should prevent user from banning themselves", async () => {
			const admin = testFactory.user({ id: "admin-1", permissionLevel: "ADMIN" });

			mockDatabase.user.findFirst.mockResolvedValue({ ...admin, devices: [] });

			const caller = await createCaller(createMockContext(admin));
			const result = await caller.setBanStatus({
				id: admin.id,
				isBanned: true,
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("NO_PERMISSION");
			}
		});
	});

	describe("list", () => {
		it("should deny normal users from listing users", async () => {
			const user = testFactory.user({ id: "user-1", permissionLevel: "USER" });

			const caller = await createCaller(createMockContext(user));
			const result = await caller.list({ limit: 10 });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("NO_PERMISSION");
			}
		});

		it("should allow admin to list users", async () => {
			const admin = testFactory.user({ id: "admin-1", permissionLevel: "ADMIN" });
			const users = [
				{ ...testFactory.user({ id: "user-1" }), devices: [] },
				{ ...testFactory.user({ id: "user-2" }), devices: [] },
			];

			mockDatabase.user.findMany.mockResolvedValue(users);

			const caller = await createCaller(createMockContext(admin));
			const result = await caller.list({ limit: 10 });

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.users).toHaveLength(2);
			}
		});

		it("should filter banned users when onlyBanned is true", async () => {
			const admin = testFactory.user({ id: "admin-1", permissionLevel: "ADMIN" });
			const bannedUser = { ...testFactory.user({ id: "user-1", isBanned: true }), devices: [] };

			mockDatabase.user.findMany.mockResolvedValue([bannedUser]);

			const caller = await createCaller(createMockContext(admin));
			const result = await caller.list({ limit: 10, onlyBanned: true });

			expect(result.ok).toBe(true);
			expect(mockDatabase.user.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { isBanned: true },
				})
			);
		});
	});

	describe("deleteUser", () => {
		it("should deny admin from deleting users", async () => {
			const admin = testFactory.user({ id: "admin-1", permissionLevel: "ADMIN" });
			const target = testFactory.user({ id: "user-1", permissionLevel: "USER" });

			const caller = await createCaller(createMockContext(admin));
			const result = await caller.deleteUser({ id: target.id });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("NO_PERMISSION");
			}
		});

		it("should allow ROOT to delete a user", async () => {
			const root = testFactory.user({ id: "root-1", permissionLevel: "ROOT" });
			const target = testFactory.user({ id: "user-1", permissionLevel: "USER" });

			mockDatabase.user.findFirst.mockResolvedValue(target);
			mockDatabase.timelapse.findMany.mockResolvedValue([]);
			mockDatabase.comment.deleteMany.mockResolvedValue({ count: 0 });
			mockDatabase.knownDevice.deleteMany.mockResolvedValue({ count: 0 });
			mockDatabase.uploadToken.deleteMany.mockResolvedValue({ count: 0 });
			mockDatabase.draftTimelapse.deleteMany.mockResolvedValue({ count: 0 });
			mockDatabase.user.delete.mockResolvedValue(target);

			const caller = await createCaller(createMockContext(root));
			const result = await caller.deleteUser({ id: target.id });

			expect(result.ok).toBe(true);
			expect(mockDatabase.user.delete).toHaveBeenCalledWith({
				where: { id: target.id },
			});
		});

		it("should prevent ROOT from deleting themselves", async () => {
			const root = testFactory.user({ id: "root-1", permissionLevel: "ROOT" });

			mockDatabase.user.findFirst.mockResolvedValue(root);

			const caller = await createCaller(createMockContext(root));
			const result = await caller.deleteUser({ id: root.id });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("NO_PERMISSION");
			}
		});

		it("should prevent deleting ROOT users", async () => {
			const root1 = testFactory.user({ id: "root-1", permissionLevel: "ROOT" });
			const root2 = testFactory.user({ id: "root-2", permissionLevel: "ROOT" });

			mockDatabase.user.findFirst.mockResolvedValue(root2);

			const caller = await createCaller(createMockContext(root1));
			const result = await caller.deleteUser({ id: root2.id });

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe("NO_PERMISSION");
			}
		});
	});
});
