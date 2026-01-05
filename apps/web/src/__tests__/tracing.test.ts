import { describe, it, expect, beforeEach } from "vitest";

import { setupDatabaseMock, resetMockDatabase } from "@/__tests__/mocks/database";
import { createAuthenticatedContext, createUnauthenticatedContext } from "@/__tests__/mocks/trpc";
import { setupServerCommonMock, serverCommonMocks } from "@/__tests__/mocks/serverCommon";

setupDatabaseMock();
setupServerCommonMock();

import tracing from "@/server/routers/api/tracing";

const validInput = {
	supportedCodecs: ["vp9", "avc1"],
	usedCodec: "vp9",
	inputs: [
		{
			codec: "vp8",
			codedWidth: 1920,
			codedHeight: 1080,
			displayWidth: 1920,
			displayHeight: 1080,
			duration: 1.234,
		},
		null,
	],
};

const createCaller = (ctx: ReturnType<typeof createAuthenticatedContext> | ReturnType<typeof createUnauthenticatedContext>) =>
	tracing.createCaller(ctx);

describe("tracing router", () => {
	beforeEach(() => {
		resetMockDatabase();
		serverCommonMocks.logTracing.mockReset();
	});

	it("requires authentication", async () => {
		const caller = createCaller(createUnauthenticatedContext());

		await expect(caller.traceEncodeStart(validInput)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("logs encode start and returns ok", async () => {
		const caller = createCaller(createAuthenticatedContext());

		const result = await caller.traceEncodeStart(validInput);

		expect(result).toEqual({ ok: true, data: {} });
		expect(serverCommonMocks.logTracing).toHaveBeenCalledTimes(1);
		expect(serverCommonMocks.logTracing).toHaveBeenCalledWith("encodeStart", validInput);
	});

	it("rejects invalid input", async () => {
		const caller = createCaller(createAuthenticatedContext());

		await expect(
			caller.traceEncodeStart({
				// @ts-expect-error - intentionally invalid for runtime validation
				supportedCodecs: "vp9",
				usedCodec: null,
				inputs: [],
			})
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});
