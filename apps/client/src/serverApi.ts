import type { JsonifiedClient } from "@orpc/openapi-client";
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { compositeRouterContract, type LapseResult } from "@hackclub/lapse-api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com";

/**
 * Pre-rendering waits on these requests, and a build without network access to the API (CI, Docker) has to give up
 * quickly rather than sit through `sfetch`'s retries. The page falls back to fetching on the client either way.
 */
const TIMEOUT_MS = 5000;

const link = new OpenAPILink(compositeRouterContract, {
  url: `${API_URL}/api`,
  fetch: (request, init) => fetch(request, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }),
});

/**
 * An anonymous API client for `getStaticProps`. It never sends credentials, so whatever it returns is what any
 * visitor would see - safe to bake into a page that the CDN serves to everyone. Signed-in viewers still refetch on
 * the client to get the fields only they are entitled to.
 */
export const serverApi: JsonifiedClient<ContractRouterClient<typeof compositeRouterContract>> = createORPCClient(link);

/**
 * Runs an anonymous API call for pre-rendering, returning `null` when it fails for any reason. `getStaticProps`
 * rejects `undefined` anywhere in its props, so the result is round-tripped through JSON to drop them.
 */
export async function prefetch<T>(caller: () => Promise<LapseResult<T>>): Promise<T | null> {
  try {
    const res = await caller();
    if (!res.ok)
      return null;

    return JSON.parse(JSON.stringify(res.data)) as T;
  }
  catch (err) {
    console.warn("(serverApi.ts) Couldn't prefetch for pre-rendering.", err);
    return null;
  }
}
