import { vi } from "vitest";

export const mockDecryptVideo = vi.fn().mockReturnValue(Buffer.from([1, 2, 3]));
export const mockDecryptToken = vi.fn().mockImplementation((token: string | null) => token);

export function setupEncryptionMock(): void {
    vi.mock("@/server/encryption", () => ({
        decryptVideo: mockDecryptVideo,
        decryptToken: mockDecryptToken
    }));
}
