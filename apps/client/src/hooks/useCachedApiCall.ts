import { useEffect } from "react";

import { useApiCall } from "@/hooks/useApiCall";
import { useCache } from "@/hooks/useCache";
import { ApiResult } from "@/shared/common";

export function useCachedApiCall<TRes>(caller: () => Promise<ApiResult<TRes>>, cacheKey: string) {
    const res = useApiCall(caller);
    const [cache, setCache] = useCache<TRes>(cacheKey);
    
    useEffect(() => {
        if (!res)
            return;

        setCache(res);
    }, [res]);

    return res ?? cache;
}