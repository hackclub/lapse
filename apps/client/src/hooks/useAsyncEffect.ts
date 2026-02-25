import { DependencyList, useEffect } from "react";

export function useAsyncEffect(callback: () => Promise<void>, deps: DependencyList) {
    useEffect(() => {
        callback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}