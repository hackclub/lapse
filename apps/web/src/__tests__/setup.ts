/**
 * Test setup file for Vitest. This file is automatically loaded before each test file.
 * Add this to vitest.config.ts under test.setupFiles if not already configured.
 */
import { beforeEach, afterEach, vi } from "vitest";
import { resetMockDatabase } from "./mocks/database";

/**
 * Reset mocks before each test to ensure isolation.
 */
beforeEach(() => {
    resetMockDatabase();
});

/**
 * Clear all mocks after each test.
 */
afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});
