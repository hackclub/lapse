import { useEffect, useRef } from "react";

export function useOnce(callback: (() => void) | (() => Promise<void>)) {
    const hasRun = useRef(false);

    useEffect(() => {
        if (hasRun.current)
            return;

        callback();
        hasRun.current = true;
    }, [callback]);
}