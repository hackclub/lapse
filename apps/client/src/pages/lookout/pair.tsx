import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { useAuth } from "@/hooks/useAuth";
import { acceptPairing, DesktopLinkError, pairingCallbackUrl } from "@/components/lookout/desktopLink";

/**
 * Consent page for linking a Lookout desktop install. The API's
 * `GET /lookout/pair` redirects here, because this is where the user is
 * logged in. Accepting mints a one-time code and hands it to the app via
 * `lookout://pair`. The redirect target is hardcoded; it is not taken from
 * the query string.
 */
export default function LookoutPairPage() {
  const router = useRouter();
  const { currentUser, isLoading } = useAuth(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [callback, setCallback] = useState<string | null>(null);

  const challenge = typeof router.query.challenge === "string" ? router.query.challenge : "";
  const state = typeof router.query.state === "string" ? router.query.state : "";
  const device = typeof router.query.device === "string" ? router.query.device : "";
  const ready = router.isReady && challenge && state && device;

  useEffect(() => {
    if (!router.isReady || isLoading)
      return;
    if (!currentUser || currentUser.private.needsReauth) {
      const redirect = encodeURIComponent(router.asPath);
      router.replace(`/auth?redirect=${redirect}`);
    }
  }, [router, isLoading, currentUser]);

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      const code = await acceptPairing({ challenge, state, device });
      const url = pairingCallbackUrl(code, state);
      setCallback(url);
      window.location.href = url;
    }
    catch (err) {
      if (err instanceof DesktopLinkError && err.status === 401) {
        const redirect = encodeURIComponent(router.asPath);
        router.replace(`/auth?redirect=${redirect}`);
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't link this device");
      setBusy(false);
    }
  }

  return (
    <RootLayout title="Link Lookout - Lapse">
      <div className="h-full flex flex-col items-center justify-center gap-6 px-8 py-16 bg-grid-gradient-up">
        <div className="flex flex-col gap-4 max-w-md w-full">
          <h1 className="text-3xl font-bold tracking-tight">Link Lookout</h1>
          {!ready && router.isReady && (
            <p className="text-smoke">This link is missing the details Lookout sent. Go back to the app and choose Lapse again.</p>
          )}
          {ready && !callback && (
            <>
              <p className="text-smoke text-pretty">
                Link <b>{device}</b> to your Lapse account? It will be able to start Lookout recordings as you, and nothing else.
              </p>
              {error && <p className="text-red">{error}</p>}
              <div className="flex flex-wrap gap-3">
                <Button kind="primary" disabled={busy || !currentUser} onClick={() => { void accept(); }}>
                  {busy ? "Linking..." : "Link this device"}
                </Button>
                <Button kind="regular" href="/lookout/devices">Linked devices</Button>
              </div>
            </>
          )}
          {callback && (
            <>
              <p className="text-smoke text-pretty">
                Lookout should open on its own. If it doesn&apos;t, paste this link into the app.
              </p>
              <CopyField value={callback} label="Lookout pairing link" />
            </>
          )}
        </div>
      </div>
    </RootLayout>
  );
}
