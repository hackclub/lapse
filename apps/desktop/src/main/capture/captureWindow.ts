/**
 * Script that runs inside the hidden capture BrowserWindow.
 *
 * This is NOT the React renderer -- it is a tiny page whose sole purpose
 * is to host a MediaRecorder and send chunks/snapshots back to the main
 * process through the `captureApi` preload bridge.
 */

import { MediaSession } from "./mediaSession";

let session: MediaSession | null = null;

// Main process sends the sourceId once the page has loaded
window.captureApi.onInit(async (sourceId: string) => {
  console.log("(captureWindow.ts) received sourceId:", sourceId);

  try {
    session = new MediaSession();
    await session.start(sourceId);
    console.log("(captureWindow.ts) capture started");
  } catch (err) {
    console.error("(captureWindow.ts) failed to start capture:", err);
  }
});

// Main process asks us to stop
window.captureApi.onStop(async () => {
  console.log("(captureWindow.ts) stop requested");

  if (session) {
    await session.stop();
    session = null;
  } else {
    // Nothing to stop -- still notify main
    window.captureApi.sendStopped();
  }
});

// Main process asks us to pause
window.captureApi.onPause(() => {
  console.log("(captureWindow.ts) pause requested");
  session?.pause();
});

// Main process asks us to resume
window.captureApi.onResume(() => {
  console.log("(captureWindow.ts) resume requested");
  session?.resume();
});
