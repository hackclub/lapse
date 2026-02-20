import { useEffect } from "react";

export function useInterval(callback: () => void, delay: number) {
    useEffect(() => {
        const timer = setInterval(callback, delay);
        callback();

        return () => clearInterval(timer);
    }, [callback, delay]);
}