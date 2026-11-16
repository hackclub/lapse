import { useEffect } from "react";
import { LapseResult } from "@hackclub/lapse-api";

import { useApiCall } from "@/hooks/useApiCall";
import { useCache } from "@/hooks/useCache";

/**
 * Calls the API once, showing the last cached response until it answers. `initial` - typically pre-rendered by
 * `getStaticProps` - is fresher than anything in `localStorage`, so it takes precedence over the cache.
 */
export function useCachedApiCall<TRes>(caller: () => Promise<LapseResult<TRes>>, cacheKey: string, initial: TRes | null = null) {
  const res = useApiCall(caller);
  const [cache, setCache] = useCache<TRes>(cacheKey);

  useEffect(() => {
    if (!res)
      return;

    setCache(res);
  }, [res]);

  return res ?? initial ?? cache;
}
