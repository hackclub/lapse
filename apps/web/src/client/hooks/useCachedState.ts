import { useCache } from "@/client/hooks/useCache";
import { useEffect, useState } from "react";

export function useCachedState<T>(key: string, initialValue: T) {
    const [value, setValue] = useState(initialValue);
    const [cached, setCached] = useCache<T>(key);

    useEffect(() => {
        if (cached !== null) {
            setValue(cached);
        }
    }, [cached, setCached]);

    return [
        value,
        (x: T) => {
            setValue(x);
            setCached(x);
        }
    ] as const;
}