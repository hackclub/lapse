import { useEffect, useState } from "react";
import Icon from "@hackclub/icons";
import posthog from "posthog-js";

import RootLayout from "@/components/layout/RootLayout";

// This page is displayed when we detect that we are missing some APIs (often Baseline 2025) that we absolutely need (e.g. OPFS ones).
// We mostly display this to a really small subset of Safari users.

export default function BrowserUpdatePage() {
  const [ua, setUserAgent] = useState("");
  const [platform, setPlatform] = useState("");

  useEffect(() => {
    setUserAgent(navigator.userAgent.toLowerCase());
    setPlatform(navigator.platform.toLowerCase());

    posthog.capture("outdated_browser_detected", { userAgent: navigator.userAgent });
    console.log(`(update-browser.tsx) outdated browser: ${navigator.userAgent}`);
  }, []);

  return (
    <RootLayout showHeader={false} title="Update your browser">
      <div className="flex flex-col items-center justify-center gap-2 p-16 h-full">
        <Icon glyph="download" size={128} className="text-muted" />
        <h1 className="text-3xl font-bold">Update your browser</h1>
        
        <p className="text-muted text-xl w-1/2 text-center">
          {
            ua.includes("safari/") && !ua.includes("chrome/")
              ? <>Lapse uses features that your version of Safari doesn't support. Try updating {platform.includes("mac") ? "macOS" : platform.includes("iphone") ? "iOS" : "iPadOS"}.</>
              : <>Lapse uses features that your browser does not support. Please update your browser to its latest version in order to use Lapse.</>
          }
        </p>
      </div>
    </RootLayout>
  );
}