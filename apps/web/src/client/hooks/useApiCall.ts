import { ApiResult } from "@/shared/common";

import { useState } from "react";
import { useOnce } from "./useOnce";

export function useApiCall<TRes>(caller: () => Promise<ApiResult<TRes>>) {
    const [value, setValue] = useState<TRes | null>(null);

    useOnce(async () => {
        const res = await caller();
        if (!res.ok) {
            console.error("(api) API call failed!", res);
            return;
        }

        setValue(res.data);
    });

    return value;
}