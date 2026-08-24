import { useEffect } from "react";
import { useRouter } from "next/router";
import type { AppType } from "next/app";

import "@/styles/globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { KeyRelayProvider } from "@/context/KeyRelayContext";
import { initLogBucket } from "@/logBucket";
import { BYPASS_BROWSER_CHECK_KEY } from "@/pages/update-browser";
import { DeviceStorage } from "@/deviceStorage";
import { api } from "@/api";

initLogBucket();

const App: AppType = ({ Component, pageProps }) => {
  const router = useRouter();

  useEffect(() => {
    if (router.pathname === "/update-browser")
      return;

    // The Lookout panel and pairing pages need none of the storage APIs this gate is
    // about - the panel is a form, embedded in another application's window, and it
    // records nothing. Bouncing it to /update-browser means an embedded webview
    // without OPFS can't publish a timelapse it already recorded, which is the one
    // thing it is there to do.
    if (router.pathname.startsWith("/lookout/"))
      return;

    if (localStorage.getItem(BYPASS_BROWSER_CHECK_KEY) === "1")
      return;

    // Redirect only when the browser genuinely lacks the OPFS APIs Lapse needs — never on a blanket
    // user-agent match. Firefox (and any other browser) that exposes the required APIs works fine, so
    // sniffing the UA bounced every Firefox user to /update-browser unconditionally. `isSupported` is
    // side-effect free and safe to call here.
    if (!DeviceStorage.isSupported())
      router.replace("/update-browser");
  }, [router]);

  useEffect(() => {
    // `/timelapse/handoff` is exempt for the same reason as the other two: it's already taking the user to
    // publish, and it has an unauthenticated state to show first that this redirect would trample.
    if (router.pathname.startsWith("/timelapse/publish")
      || router.pathname.startsWith("/timelapse/create")
      || router.pathname.startsWith("/timelapse/handoff")
      // Same reasoning, and more so: the panel IS the publish step for its own draft,
      // so redirecting it to some other draft's publish page is nonsense.
      || router.pathname.startsWith("/lookout/"))
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
