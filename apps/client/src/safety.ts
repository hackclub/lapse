import { sleep } from "@/common";

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
export async function retryable<T>(label: string, procedure: () => T | Promise<T>): Promise<T | Error> {
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