import { vi } from "vitest";

export const mockGenerateThumbnail = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3]));

export function setupVideoProcessingMock(): void {
    vi.mock("@/server/videoProcessing", () => ({
        generateThumbnail: mockGenerateThumbnail
    }));
}
