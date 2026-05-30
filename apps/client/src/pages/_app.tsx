import { useEffect } from "react";
import { useRouter } from "next/router";
import type { AppType } from "next/app";

import "@/styles/globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { KeyRelayProvider } from "@/context/KeyRelayContext";
import { initLogBucket } from "@/logBucket";
import { BYPASS_BROWSER_CHECK_KEY } from "@/pages/update-browser";

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

  return (
    <AuthProvider>
      <KeyRelayProvider>
        <Component {...pageProps} />
      </KeyRelayProvider>
    </AuthProvider>
  );
};

export default App;
