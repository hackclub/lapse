import { useEffect, useRef } from "react";

export function useOnce(callback: (() => void) | (() => Promise<void>)) {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current)
      return;

    // The callback may be async; a rejected promise here would otherwise be an unhandled rejection.
    // Surface it instead of letting it vanish silently.
    Promise.resolve(callback()).catch(err => {
      console.error("(useOnce) callback rejected", err);
    });
    hasRun.current = true;
  }, [callback]);
}