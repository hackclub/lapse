import { sleep } from "@hackclub/lapse-shared";
import fetchRetry from "fetch-retry";

/**
 * Catches all errors `procedure` might throw, and if one is thrown, returns it. Otherwise,
 * this function returns the return value of `procedure`.
 */
export async function safely<T>(procedure: () => T | Promise<T>): Promise<T | Error> {
  try {
    return await procedure();
  }
  catch (err) {
    return err instanceof Error ? err : new Error(`${err}`);
  }
}

/**
 * Invokes `procedure` multiple times with exponential backoff. If `procedure` throws an error, it will
 * be catched and invoked at a later time. If the retry limit is reached, the last thrown error is returned.
 */
export async function retryable<T>(procedure: () => T | Promise<T>): Promise<T | Error>;
export async function retryable<T>(label: string, procedure: () => T | Promise<T>): Promise<T | Error>;

export async function retryable<T>(labelOrProcedure: string | (() => T | Promise<T>), maybeProcedure?: () => T | Promise<T>): Promise<T | Error> {
  const label = typeof labelOrProcedure === "string" ? labelOrProcedure : "procedure";
  const procedure = typeof labelOrProcedure === "function" ? labelOrProcedure : maybeProcedure!;
  
  let lastError: Error | null = null;
  let delay = 250;

  for (let attempt = 0; attempt < 5; attempt++) {
    const value = await safely(procedure);
    if (value instanceof Error) {
      console.error(`(safety.ts) Attempt #${attempt + 1} failed for ${label}. Retrying in ${delay}ms.`, value);

      await sleep(delay);
      delay *= 2;

      console.log(`(safety.ts) Retrying ${label} now (attempt #${attempt + 1}).`, procedure);
      lastError = value;
    }
    else {
      return value;
    }
  }

  return lastError ?? new Error("Unknown error.");
}

/**
 * A version of `fetch` that retries on network errors.
 */
export const sfetch = fetchRetry(fetch, {
  retries: 5,
  retryDelay(attempt, error, response) {
    const delay = Math.pow(2, attempt) * 500;
    console.warn(`(safety.ts) fetch failed - retrying in ${delay}ms`, error, response);
    return delay;
  }
});

/**
 * A version of `fetch` for non-critical media (thumbnails, previews) where the worst case is a placeholder. It retries
 * at most *once* on a network error, so a single transient blip is still tolerated, but an unreachable or missing
 * resource degrades immediately to a placeholder instead of producing a 5-deep exponential-backoff retry storm
 * (which, fanned out across a grid of thumbnails, floods the console and hammers the CDN for no benefit).
 */
export const mediaFetch = fetchRetry(fetch, {
  retries: 1,
  retryDelay: 500
});
