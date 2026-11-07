import { loadRecorderModule } from "@lookout/react";

/**
 * Whether this browser can run Lookout's in-browser recorder, which is WebAssembly.
 *
 * Every browser Lapse supports can, but WebAssembly can still be switched off underneath us - Safari's
 * Lockdown Mode, hardened Edge/Chrome configurations, enterprise policies. We'd rather find that out
 * on the mode picker than after the user has already shared their screen, so this loads the real
 * module (which also means it is warm by the time the recording starts).
 *
 * Resolves to `null` when the recorder is usable, or a human-readable reason when it isn't.
 */
export async function checkBrowserRecorderSupport(): Promise<string | null> {
  if (typeof WebAssembly !== "object" || typeof WebAssembly.instantiate !== "function")
    return "WebAssembly is turned off in this browser (for example by Lockdown Mode or a browser policy).";

  try {
    await loadRecorderModule();
    return null;
  }
  catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `This browser couldn't load the recorder (${detail}).`;
  }
}
