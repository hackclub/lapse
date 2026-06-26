import { useEffect } from "react";
import { useRouter } from "next/router";
import type { AppType } from "next/app";

import "@/styles/globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { KeyRelayProvider } from "@/context/KeyRelayContext";
import { initLogBucket } from "@/logBucket";
import { BYPASS_BROWSER_CHECK_KEY } from "@/pages/update-browser";
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

    // Never probe a protected endpoint on the auth pages or without a session. The request would 401 and
    // trip the global redirect-to-/auth interceptor in `api.ts` — which, on the auth callback, wipes the
    // in-flight `?code=` exchange and bounces the user back into OAuth, looping forever. Logged-out users
    // also shouldn't be force-redirected to sign in just for opening a public page.
    if (router.pathname === "/auth" || router.pathname.startsWith("/oauth/"))
      return;

    if (!localStorage.getItem("lapse:token"))
      return;

    (async () => {
      try {
        const res = await api.timelapse.getLookoutDrafts({});
        if (!res.ok) return;

        for (const draft of res.data.drafts) {
          if (draft.lookoutStatus === "complete" || draft.lookoutStatus === "stopped" || draft.lookoutStatus === "compiling") {
            router.replace(`/timelapse/publish/${draft.id}`);
            return;
          }
        }
      } catch {
        // Not logged in or network error — ignore
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
