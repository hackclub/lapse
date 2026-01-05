import { vi } from "vitest";

export const serverCommonMocks = {
    logTracing: vi.fn(),
    logInfo: vi.fn(),
    logWarning: vi.fn(),
    logError: vi.fn(),
    logRequest: vi.fn(),
    logNextRequest: vi.fn(),
};

export function setupServerCommonMock(): void {
    vi.mock("@/server/serverCommon", () => serverCommonMocks);
}
