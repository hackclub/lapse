import { vi } from "vitest";

export const mockS3Send = vi.fn().mockResolvedValue({});

export function setupS3Mock(): void {
    vi.mock("@aws-sdk/client-s3", () => ({
        S3Client: class MockS3Client {
            send = mockS3Send;
        },
        DeleteObjectCommand: class DeleteObjectCommand {
            constructor(public input: unknown) {}
        },
        GetObjectCommand: class GetObjectCommand {
            constructor(public input: unknown) {}
        },
        PutObjectCommand: class PutObjectCommand {
            constructor(public input: unknown) {}
        },
    }));
}
