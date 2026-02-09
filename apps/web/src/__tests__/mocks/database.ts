import { vi, type Mock } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

type MockPrismaModel<T> = {
    findUnique: Mock<(args: unknown) => Promise<T | null>>;
    findUniqueOrThrow: Mock<(args: unknown) => Promise<T>>;
    findFirst: Mock<(args: unknown) => Promise<T | null>>;
    findFirstOrThrow: Mock<(args: unknown) => Promise<T>>;
    findMany: Mock<(args: unknown) => Promise<T[]>>;
    create: Mock<(args: unknown) => Promise<T>>;
    createMany: Mock<(args: unknown) => Promise<{ count: number }>>;
    update: Mock<(args: unknown) => Promise<T>>;
    updateMany: Mock<(args: unknown) => Promise<{ count: number }>>;
    upsert: Mock<(args: unknown) => Promise<T>>;
    delete: Mock<(args: unknown) => Promise<T>>;
    deleteMany: Mock<(args: unknown) => Promise<{ count: number }>>;
    count: Mock<(args: unknown) => Promise<number>>;
    aggregate: Mock<(args: unknown) => Promise<unknown>>;
    groupBy: Mock<(args: unknown) => Promise<unknown[]>>;
};

function createMockModel<T>(): MockPrismaModel<T> {
    return {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        findFirstOrThrow: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        createMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
        aggregate: vi.fn(),
        groupBy: vi.fn(),
    };
}

export type MockDatabase = {
    user: MockPrismaModel<unknown>;
    timelapse: MockPrismaModel<unknown>;
    snapshot: MockPrismaModel<unknown>;
    knownDevice: MockPrismaModel<unknown>;
    comment: MockPrismaModel<unknown>;
    uploadToken: MockPrismaModel<unknown>;
    draftTimelapse: MockPrismaModel<unknown>;
    serviceClient: MockPrismaModel<unknown>;
    serviceGrant: MockPrismaModel<unknown>;
    serviceTokenAudit: MockPrismaModel<unknown>;
    serviceClientReview: MockPrismaModel<unknown>;
    $transaction: Mock<(fn: (tx: MockDatabase) => Promise<unknown>) => Promise<unknown>>;
    $connect: Mock<() => Promise<void>>;
    $disconnect: Mock<() => Promise<void>>;
    $executeRaw: Mock<(query: unknown) => Promise<number>>;
    $queryRaw: Mock<(query: unknown) => Promise<unknown[]>>;
};

/**
 * Creates a mock database instance with all models and methods stubbed.
 */
export function createMockDatabase(): MockDatabase {
    return {
        user: createMockModel(),
        timelapse: createMockModel(),
        snapshot: createMockModel(),
        knownDevice: createMockModel(),
        comment: createMockModel(),
        uploadToken: createMockModel(),
        draftTimelapse: createMockModel(),
        serviceClient: createMockModel(),
        serviceGrant: createMockModel(),
        serviceTokenAudit: createMockModel(),
        serviceClientReview: createMockModel(),
        $transaction: vi.fn((fn) => fn(mockDatabase)),
        $connect: vi.fn(),
        $disconnect: vi.fn(),
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn(),
    };
}

/**
 * The mock database instance. This is the mock that will be used when `@/server/db` is imported.
 */
export const mockDatabase = createMockDatabase();

/**
 * Creates a mock database with realistic constraints simulation.
 */
export function createConstrainedMockDatabase() {
    const db = createMockDatabase();
    
    // Simulate database constraints and realistic behavior
    db.user.findFirst.mockImplementation(async (query: any) => {
        if (query.where?.email === "taken@example.com" || query.where?.handle === "taken-handle") {
            return null; // Email or handle already taken
        }

        // Return default user for other cases
        const defaultImpl = db.user.findFirst.getMockImplementation();
        return defaultImpl ? defaultImpl(query) : null;
    });
    
    db.serviceClient.findFirst.mockImplementation(async (query: any) => {
        if (query.where?.clientId?.startsWith?.("revoked_")) {
            return null; // Client is revoked
        }
        const defaultImpl = db.serviceClient.findFirst.getMockImplementation();
        return defaultImpl ? defaultImpl(query) : null;
    });
    
    return db;
}

/**
 * Resets all mock functions in the database mock. Call this in `beforeEach` to ensure
 * tests are isolated and prevents test interference.
 */
export function resetMockDatabase(): void {
    // Clear all mocks completely to prevent test interference
    vi.clearAllMocks();
    
    // Reset individual model mocks while preserving their mock implementations
    const resetModel = (model: MockPrismaModel<unknown>) => {
        Object.values(model).forEach((fn) => {
            if (typeof fn === "function" && "mockReset" in fn) {
                fn.mockReset();
            }
        });
    };

    resetModel(mockDatabase.user);
    resetModel(mockDatabase.timelapse);
    resetModel(mockDatabase.snapshot);
    resetModel(mockDatabase.knownDevice);
    resetModel(mockDatabase.comment);
    resetModel(mockDatabase.uploadToken);
    resetModel(mockDatabase.draftTimelapse);
    resetModel(mockDatabase.serviceClient);
    resetModel(mockDatabase.serviceGrant);
    resetModel(mockDatabase.serviceTokenAudit);
    resetModel(mockDatabase.serviceClientReview);
    
    // Reset transaction mock to use the current database state
    mockDatabase.$transaction.mockImplementation((fn) => fn(mockDatabase));
}

/**
 * Sets up the database mock module. Call this at the top of your test file, before any imports
 * that depend on `@/server/db`.
 *
 * @example
 * ```typescript
 * import { setupDatabaseMock, mockDatabase, resetMockDatabase } from "@/__tests__/mocks/database";
 *
 * setupDatabaseMock();
 *
 * describe("my test", () => {
 *   beforeEach(() => {
 *     resetMockDatabase();
 *   });
 *
 *   it("should find a user", async () => {
 *     const mockUser = testFactory.user();
 *     mockDatabase.user.findUnique.mockResolvedValue(mockUser);
 *
 *     // ... your test code
 *   });
 * });
 * ```
 */
export function setupDatabaseMock(): void {
    vi.mock("@/server/db", () => ({
        database: mockDatabase,
    }));
}
