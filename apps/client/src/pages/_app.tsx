import { useEffect } from "react";
import { useRouter } from "next/router";
import type { AppType } from "next/app";

import "@/styles/globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { KeyRelayProvider } from "@/context/KeyRelayContext";
import { initLogBucket } from "@/logBucket";
import { BYPASS_BROWSER_CHECK_KEY } from "@/pages/update-browser";
import { getStoredSessions, removeStoredSession } from "@/components/lookout/LookoutRecorder";
import { api } from "@/api";

initLogBucket();

const UNSUPPORTED_BROWSER_PATTERNS = [/firefox\//i];

const App: AppType = ({ Component, pageProps }) => {
  const router = useRouter();

  useEffect(() => {
    if (router.pathname === "/update-browser")
      return;

    if (localStorage.getItem(BYPASS_BROWSER_CHECK_KEY) === "1")
      return;

    const ua = navigator.userAgent;
    if (UNSUPPORTED_BROWSER_PATTERNS.some(pattern => pattern.test(ua)))
      router.replace("/update-browser");
  }, [router]);

  useEffect(() => {
    if (router.pathname.startsWith("/timelapse/publish") || router.pathname.startsWith("/timelapse/create"))
      return;

    const sessions = getStoredSessions();
    if (sessions.length === 0) return;

    (async () => {
      for (const session of sessions) {
        try {
          const res = await api.timelapse.pollLookoutStatus(
            session.lookoutSessionId
              ? { lookoutSessionId: session.lookoutSessionId }
              : { id: session.timelapseId }
          );
          if (!res.ok) {
            removeStoredSession(session.timelapseId);
            continue;
          }

          const status = res.data.lookoutStatus;
          if (status === "complete" || status === "stopped" || status === "compiling") {
            router.replace(`/timelapse/publish/${session.timelapseId}`);
            return;
          }

          if (status === "failed") {
            removeStoredSession(session.timelapseId);
          }
        } catch {
          removeStoredSession(session.timelapseId);
        }
      }
    })();
  }, [router]);

  return (
    <AuthProvider>
      <KeyRelayProvider>
        <Component {...pageProps} />
      </KeyRelayProvider>
    </AuthProvider>
  );
};

export default App;
