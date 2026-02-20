import { useEffect, useState } from "react";

/**
 * Returns a value cached inside `localStorage`, which persists over different sessions, and a function to change it.
 */
export function useCache<T>(key: string) {
    const [value, setValue] = useState<T | null>(null);

    useEffect(() => {
        const raw = localStorage.getItem(`lapse.cache.${key}`);
        if (!raw)
            return;

        let obj: T | null;
        try {
            obj = JSON.parse(raw);
        }
        catch {
            obj = null;
        }

        setValue(obj);
    }, [key]);

    return [
        value,
        (obj: T | null) => {
            setValue(obj);

            if (obj) {
                localStorage.setItem(`lapse.cache.${key}`, JSON.stringify(obj));
            }
            else {
                localStorage.removeItem(`lapse.cache.${key}`);
            }
        }
    ] as const;
}