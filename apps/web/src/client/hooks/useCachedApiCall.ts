import { useApiCall } from "@/client/hooks/useApiCall";
import { useCache } from "@/client/hooks/useCache";
import { ApiResult } from "@/shared/common";
import { useEffect } from "react";

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