import { useState } from "react";

import { type LapseResult } from "@hackclub/lapse-api";
import { useOnce } from "@/hooks/useOnce";

export function useApiCall<TRes>(caller: () => Promise<LapseResult<TRes>>) {
    const [value, setValue] = useState<TRes | null>(null);

    useOnce(async () => {
        const res = await caller();
        if (!res.ok) {
            console.error("(useApiCall.ts) API call failed!", res);
            return;
        }

        setValue(res.data);
    });

    return value;
}