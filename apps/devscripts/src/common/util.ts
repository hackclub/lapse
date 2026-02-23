/**
 * Returns a `Promise<void>` that resolves after `ms` milliseconds.
 */
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
