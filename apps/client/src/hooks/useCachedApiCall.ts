import { useEffect } from "react";
import { LapseResult } from "@hackclub/lapse-api";

import { useApiCall } from "@/hooks/useApiCall";
import { useCache } from "@/hooks/useCache";

export function useCachedApiCall<TRes>(caller: () => Promise<LapseResult<TRes>>, cacheKey: string) {
  const res = useApiCall(caller);
  const [cache, setCache] = useCache<TRes>(cacheKey);

  useEffect(() => {
    if (!res)
      return;

    setCache(res);
  }, [res]);

  return res ?? cache;
}