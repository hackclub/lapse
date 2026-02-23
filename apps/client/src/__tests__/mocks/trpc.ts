import { vi } from "vitest";
import type { Context } from "@/server/trpc";
import type { User } from "@/generated/prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { testFactory } from "@/__tests__/factories";

/**
 * Creates a mock tRPC context for testing procedures.
 */
export function createMockContext(user: User | null = null): Context {
    return {
        req: {
            headers: {},
            cookies: {},
        } as unknown as NextApiRequest,
        res: {
            setHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        } as unknown as NextApiResponse,
        user,
        scopes: []
    };
}

/**
 * Creates a mock authenticated context with a test user.
 */
export function createAuthenticatedContext(userOverrides: Partial<User> = {}): Context {
    return createMockContext(testFactory.user(userOverrides));
}

/**
 * Creates a mock unauthenticated context.
 */
export function createUnauthenticatedContext(): Context {
    return createMockContext(null);
}
