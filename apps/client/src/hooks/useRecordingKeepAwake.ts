import { useEffect } from "react";

// How far the wall clock may run ahead of a 5s interval before we treat it as the machine (or the
// tab) having been asleep.
const WAKE_CHECK_INTERVAL_MS = 5_000;
const WAKE_GAP_MS = 30_000;

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
};

type WakeLockLike = {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
};

/**
 * Keeps a browser recording alive through the things a browser does to a page nobody is looking at.
 *
 * Lookout's recorder runs on the page's own timers, so it only captures as often as the browser lets
 * those timers fire. `@lookout/react` already plays silent audio to keep the tab exempt from Chrome's
 * background throttling and tab freezing, but nothing brings that audio back once the OS suspends it -
 * which is exactly what a laptop going to sleep does. This hook covers the gaps:
 *
 *   - a screen wake lock while the page is visible, so the machine doesn't idle into sleep mid-session
 *     (the desktop app holds the same assertion while capturing);
 *   - a second silent audio graph of our own that is resumed whenever the browser suspends it;
 *   - re-acquiring both after the page comes back from being hidden, frozen, restored from the
 *     back/forward cache, or the machine waking up.
 *
 * The recorder itself already recovers its session after a sleep (it sees the gap and re-checks the
 * session with Lookout), so all this has to do is keep the page awake enough for it to run.
 *
 * Every API here is feature-detected, so browsers without one just go without that layer.
 */
export function useRecordingKeepAwake(active: boolean) {
  useEffect(() => {
    if (!active || typeof window === "undefined")
      return;

    let disposed = false;
    let wakeLock: WakeLockSentinelLike | null = null;
    let wakeLockPending = false;
    let audio: AudioContext | null = null;
    let oscillator: OscillatorNode | null = null;

    const wakeLockApi = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;

    async function acquireWakeLock() {
      if (!wakeLockApi || wakeLockPending || document.visibilityState !== "visible")
        return;

      if (wakeLock && !wakeLock.released)
        return;

      wakeLockPending = true;
      try {
        const sentinel = await wakeLockApi.request("screen");
        if (disposed) {
          await sentinel.release().catch(() => {});
          return;
        }

        wakeLock = sentinel;
      }
      catch {
        // Refused (battery saver, a permissions policy, an unfocused window). The audio keepalive still
        // stands, and we try again the next time the page becomes visible.
      }
      finally {
        wakeLockPending = false;
      }
    }

    function startAudio() {
      const Ctor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!Ctor)
        return;

      try {
        audio = new Ctor();
        const gain = audio.createGain();
        gain.gain.value = 0;
        oscillator = audio.createOscillator();
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start();
        audio.addEventListener("statechange", resumeAudio);
      }
      catch {
        audio = null;
        oscillator = null;
      }
    }

    function resumeAudio() {
      // Safari reports "interrupted" (not in the TS lib) when another app or the OS takes the audio session.
      if (!audio || (audio.state as string) === "running" || audio.state === "closed")
        return;

      audio.resume().catch(() => {
        // Needs a user gesture on this browser - the pointer/key listeners below will retry.
      });
    }

    function revive() {
      if (disposed)
        return;

      resumeAudio();
      void acquireWakeLock();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible")
        revive();
    }

    let lastTick = Date.now();
    const wakeCheck = window.setInterval(() => {
      const now = Date.now();
      if (now - lastTick > WAKE_GAP_MS)
        revive();

      lastTick = now;
    }, WAKE_CHECK_INTERVAL_MS);

    startAudio();
    void acquireWakeLock();

    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("resume", revive);
    window.addEventListener("pageshow", revive);
    window.addEventListener("focus", revive);
    window.addEventListener("online", revive);
    window.addEventListener("pointerdown", resumeAudio, true);
    window.addEventListener("keydown", resumeAudio, true);

    return () => {
      disposed = true;
      window.clearInterval(wakeCheck);

      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("resume", revive);
      window.removeEventListener("pageshow", revive);
      window.removeEventListener("focus", revive);
      window.removeEventListener("online", revive);
      window.removeEventListener("pointerdown", resumeAudio, true);
      window.removeEventListener("keydown", resumeAudio, true);

      wakeLock?.release().catch(() => {});
      wakeLock = null;

      try {
        oscillator?.stop();
      }
      catch {
        // Already stopped.
      }

      audio?.removeEventListener("statechange", resumeAudio);
      audio?.close().catch(() => {});
      audio = null;
      oscillator = null;
    };
  }, [active]);
}
