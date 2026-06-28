import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

// This page is displayed when we detect that we are missing some APIs (often Baseline 2025) that we absolutely need (e.g. OPFS ones).
// We mostly display this to a really small subset of Safari users.

export const BYPASS_BROWSER_CHECK_KEY = "lapse:bypass_browser_check";

export default function BrowserUpdatePage() {
  const [ua, setUserAgent] = useState("");
  const [platform, setPlatform] = useState("");
  const [showWarning, setShowWarning] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setUserAgent(navigator.userAgent.toLowerCase());
    setPlatform(navigator.platform.toLowerCase());

    console.log(`(update-browser.tsx) outdated browser: ${navigator.userAgent}`);
  }, []);

  function handleContinueAnyway() {
    if (!showWarning) {
      setShowWarning(true);
      return;
    }

    localStorage.setItem(BYPASS_BROWSER_CHECK_KEY, "1");
    router.push("/");
  }

  return (
    <RootLayout showHeader={false} title="Update your browser">
      <div className="flex flex-col items-center justify-center gap-2 p-16 h-full">
        <Icon glyph="download" size={128} className="text-muted" />
        <h1 className="text-3xl font-bold">Update your browser</h1>
        
        <p className="text-muted text-xl w-1/2 text-center">
          {
            ua.includes("firefox/")
              ? <>Lapse uses browser features that Firefox does not support. For a better experience using Lapse, use a Chromium-based browser such as Google Chrome or Microsoft Edge.</>
              : ua.includes("safari/") && !ua.includes("chrome/")
                ? <>Lapse uses features that your version of Safari doesn't support. Try updating {platform.includes("mac") ? "macOS" : platform.includes("iphone") ? "iOS" : "iPadOS"}.</>
                : <>Lapse uses features that your browser does not support. Please update your browser to its latest version in order to use Lapse.</>
          }
        </p>

        {showWarning && (
          <div className="w-1/2 mt-2">
            <Alert variant="warning" icon="important">
              <p className="font-bold">Experimental — things may break</p>
              <p className="text-sm mt-1">Lapse relies on browser features your browser doesn't support. Continuing anyway may cause data loss, crashes, or other unexpected behaviour. Click again to proceed.</p>
            </Alert>
          </div>
        )}

        <Button
          kind="destructive"
          onClick={handleContinueAnyway}
          className="mt-4"
        >
          Continue anyway
        </Button>
      </div>
    </RootLayout>
  );
}