import { useEffect, useRef } from "react";

export function useInterval(callback: () => void, delay: number) {
  // Held in a ref so an inline callback - a new function on every render - doesn't tear down and
  // immediately re-fire the interval each time the component renders.
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    const tick = () => latest.current();
    const timer = setInterval(tick, delay);
    tick();

    return () => clearInterval(timer);
  }, [delay]);
}
