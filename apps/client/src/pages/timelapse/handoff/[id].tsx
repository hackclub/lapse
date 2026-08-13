import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";

import { api } from "@/api";
import { useAuthContext } from "@/context/AuthContext";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { NOT_FOUND_STATUS, StatusPage } from "@/components/layout/StatusPage";

/**
 * Where Lookout sends the user when a timelapse they recorded in the desktop app finishes compiling (its
 * `redirectUrl` hook, set when we create the session). It opens in their *default* browser, which is not
 * necessarily the one they started the recording in - so unlike the rest of the recording flow, this page
 * can't assume a signed-in session, and says so instead of bouncing them into OAuth unannounced.
 *
 * It exists as its own route rather than pointing the hook straight at `/timelapse/publish/:id` because the
 * hook is immutable: every session ever created carries the URL it was born with, forever. Keeping a page of
 * our own in front of the publish flow means that URL stays valid even if the flow behind it moves.
 */
export default function Page() {
  const router = useRouter();
  const { currentUser, isLoading } = useAuthContext();

  const rawId = router.query.id as string | undefined;
  const draftId = rawId && rawId !== "undefined" ? rawId : undefined;

  const [gone, setGone] = useState(false);
  // This page's own URL, for the "wrong browser" case below. Read after mount - it doesn't exist during
  // prerender, and it has to be the absolute form to be worth pasting anywhere.
  const [handoffUrl, setHandoffUrl] = useState("");

  useEffect(() => {
    setHandoffUrl(window.location.href);
  }, []);

  useEffect(() => {
    if (!router.isReady || isLoading || !draftId) return;

    // Signing in returns here, not to the homepage, so the handoff survives the detour.
    if (!currentUser) return;

    (async () => {
      // The draft is the whole point of the trip - if it's already been published or discarded (from another
      // tab, another device, or an earlier visit to this same link), there's nothing to hand off to.
      try {
        const res = await api.timelapse.pollLookoutStatus({ draftId });
        // Only a missing draft ends the trip here. Any other failure (Lookout being down, say) is the publish
        // page's problem - it polls the same endpoint and reports errors properly.
        if (!res.ok && res.error === "NOT_FOUND") {
          setGone(true);
          return;
        }
      } catch {
        // A network blip shouldn't strand the user here either.
      }

      router.replace(`/timelapse/publish/${draftId}`);
    })();
  }, [router, router.isReady, isLoading, currentUser, draftId]);

  if (router.isReady && !draftId) {
    return <StatusPage {...NOT_FOUND_STATUS} />;
  }

  if (gone) {
    return (
      <RootLayout>
        <div className="min-h-screen flex items-center justify-center px-4 py-12">
          <div className="flex flex-col items-center text-center gap-6 max-w-md">
            <Icon glyph="checkmark" size={48} className="text-green" />
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold">Nothing left to publish</h1>
              <p className="text-muted">
                This recording has already been published or discarded. Your timelapses are on your profile.
              </p>
            </div>
            <Button kind="primary" href="/" className="w-full">Go home</Button>
          </div>
        </div>
      </RootLayout>
    );
  }

  // Lookout opens the redirect in the user's *default* browser, which isn't necessarily the one they started
  // recording in. Rather than pushing them through a second sign-in here, point them back at the browser that
  // already has their session: opening Lapse there lands them on this timelapse's publish page by itself (see
  // the draft check in `_app.tsx`). Signing in here still works for anyone who'd rather - or has to.
  if (!isLoading && !currentUser) {
    return (
      <RootLayout>
        <div className="min-h-screen flex items-center justify-center px-4 py-12">
          <div className="flex flex-col items-center text-center gap-6 max-w-md">
            <Icon glyph="clock" size={48} className="text-red" />
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold">Your timelapse is ready</h1>
              <p className="text-muted">
                This browser isn&apos;t signed in to Lapse. Head back to the browser you started recording
                in - it&apos;ll pick up right where you left off.
              </p>
            </div>

            <div className="flex flex-col gap-2 w-full">
              <p className="text-sm text-muted">Or paste this link over there:</p>
              <CopyField value={handoffUrl} label="Link to this timelapse" />
            </div>

            <a
              href={`/auth?redirect=${encodeURIComponent(`/timelapse/handoff/${draftId ?? ""}`)}`}
              className="text-sm text-muted hover:text-white underline transition-colors"
            >
              Sign in here instead
            </a>
          </div>
        </div>
      </RootLayout>
    );
  }

  return (
    <RootLayout>
      <LoadingModal isOpen title="Your timelapse is ready" message="Taking you to publish..." />
    </RootLayout>
  );
}
