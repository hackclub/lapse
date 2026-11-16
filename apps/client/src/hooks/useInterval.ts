import { useEffect, useRef } from "react";

/**
 * Calls `callback` now and then every `delay` ms. A `null` delay calls it once and never again.
 *
 * With `pauseWhenHidden`, nothing runs while the tab is in the background, and the callback fires as soon as it comes
 * back - for polls that only matter to someone looking at the page. Left-open tabs otherwise poll forever.
 */
export function useInterval(callback: () => void, delay: number | null, { pauseWhenHidden = false }: { pauseWhenHidden?: boolean } = {}) {
  // Held in a ref so an inline callback - a new function on every render - doesn't tear down and
  // immediately re-fire the interval each time the component renders.
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    const tick = () => latest.current();
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      tick();
      if (delay !== null)
        timer = setInterval(tick, delay);
    };

    const stop = () => {
      if (timer !== null)
        clearInterval(timer);

      timer = null;
    };

    if (!pauseWhenHidden) {
      start();
      return stop;
    }

    const onVisibilityChange = () => {
      stop();
      if (document.visibilityState === "visible")
        start();
    };

    if (document.visibilityState === "visible")
      start();

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [delay, pauseWhenHidden]);
}
