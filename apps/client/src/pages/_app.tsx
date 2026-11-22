import { useEffect, type CSSProperties } from "react";
import { useRouter } from "next/router";
import type { AppType } from "next/app";
import { SkulletProvider } from "skullet/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { SkulletTheme } from "skullet";
import { Toaster, type ToastClassnames } from "sonner";
import clsx from "clsx";

import "@/styles/globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { KeyRelayProvider } from "@/context/KeyRelayContext";
import { MaintenanceProvider } from "@/context/MaintenanceContext";
import { ReadyDraftsProvider } from "@/context/ReadyDraftsContext";
import { initLogBucket } from "@/logBucket";
import { BYPASS_BROWSER_CHECK_KEY } from "@/pages/update-browser";
import { DeviceStorage } from "@/deviceStorage";
import { phantomSans } from "@/fonts";

initLogBucket();

// Lapse only has a dark theme, so only dark colours are given. Skullet's default highlight sits barely above its
// base, which on `--color-dark` reads as a static grey block - this one is bright enough for the sweep to be seen.
const SKELETON_THEME: SkulletTheme = {
  dark: { base: "rgb(255 255 255 / 0.07)", highlight: "rgb(255 255 255 / 0.22)" },
  animation: "shimmer",
  speed: "fast",
  radius: "6px",
  text: { top: "ascender", bottom: "descender" }
};

// Sonner's own toast, in Lapse's colours.
const TOASTER_STYLE = {
  "--normal-bg": "var(--color-dark)",
  "--normal-border": "var(--color-slate)",
  "--normal-bg-hover": "var(--color-darkless)",
  "--normal-border-hover": "var(--color-muted)",
  "--normal-text": "var(--color-white)",
  "--border-radius": "16px",
  "--width": "400px",
} as CSSProperties;

const TOAST_CLASSES: ToastClassnames = {
  toast: clsx(phantomSans.className, "gap-3.5! p-3! pr-4! shadow-[0_16px_48px_rgb(0_0_0/0.5)]!"),
  title: "font-bold! text-base! leading-tight!",
  description: "text-secondary! text-sm!",
  icon: "w-auto! h-auto! m-0!",
  actionButton: "bg-red! text-white! font-bold! text-sm! h-9! px-4! rounded-full! transition-[scale]! hover:scale-[104%]! active:scale-[96%]!",
};

// Speed Insights reports to an endpoint only Vercel serves. Self-hosted builds (`client.Dockerfile`) would just 404 it.
const IS_VERCEL = Boolean(process.env.NEXT_PUBLIC_VERCEL_ENV);

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

  return (
    <SkulletProvider mode="dark" theme={SKELETON_THEME} reveal="sweep">
      <AuthProvider>
        <MaintenanceProvider>
          <KeyRelayProvider>
            <ReadyDraftsProvider>
              <Component {...pageProps} />
              {/* On mobile, toasts sit above the bottom navigation bar. Swiping is off: a toast stays until its close
                  button, so nobody flicks away a reminder by accident. */}
              <Toaster
                theme="dark"
                position="bottom-center"
                offset={24}
                mobileOffset={{ bottom: 104 }}
                gap={10}
                swipeDirections={[]}
                style={TOASTER_STYLE}
                toastOptions={{ classNames: TOAST_CLASSES }}
              />
              { IS_VERCEL && <SpeedInsights /> }
            </ReadyDraftsProvider>
          </KeyRelayProvider>
        </MaintenanceProvider>
      </AuthProvider>
    </SkulletProvider>
  );
};

export default App;
