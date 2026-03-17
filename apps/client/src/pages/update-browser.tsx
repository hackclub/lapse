import { useEffect } from "react";
import Icon from "@hackclub/icons";
import posthog from "posthog-js";

import RootLayout from "@/components/layout/RootLayout";

// This page is displayed when we detect that we are missing some APIs (often Baseline 2025) that we absolutely need (e.g. OPFS ones).
// We mostly display this to a really small subset of Safari users.

export default function BrowserUpdatePage() {
  useEffect(() => {
    posthog.capture("outdated_browser_detected", { userAgent: navigator.userAgent });
    console.log(`(update-browser.tsx) outdated browser: ${navigator.userAgent}`);
  }, []);

  return (
    <RootLayout showHeader={false} title="Admin Dashboard">
      <div className="flex flex-col items-center justify-center gap-2 p-16 h-full">
        <Icon glyph="download" size={128} className="text-muted" />
        <h1 className="text-3xl font-bold">Update your browser</h1>
        
        <p className="text-muted text-xl w-1/3 text-center">
          Lapse uses features that your browser does not support. Please update your browser to its latest version in order to use Lapse.
        </p>
      </div>
    </RootLayout>
  );
}