import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { OAUTH_SCOPE_GROUPS } from "@hackclub/lapse-api";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import Icon from "@hackclub/icons";
import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { Alert } from "@/components/ui/Alert";
import { TextInput } from "@/components/ui/TextInput";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com";

type AppInfo = {
  name: string;
  description: string;
  iconUrl: string;
  trustLevel: "TRUSTED" | "UNTRUSTED";
  scopes: string[];
};

const SILLY_SCOPES = [
  "Reach a million weighted grants",
  "Invite Heidi over for a nice cup of tea",
  "Reboot the webserver because of Chip",
  "Organize a BBQ with a certain dinosaur",
  "Help Orpheus find true love",
  "Prove that P = NP",
  "Help Niko return the sun"
];

export default function OAuthAuthorize() {
  const router = useRouter();
  const auth = useAuth(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [typedName, setTypedName] = useState("");
  const [sillyScope] = useState(SILLY_SCOPES[Math.floor(Math.random() * SILLY_SCOPES.length)]);

  const clientId = typeof router.query.clientId === "string" ? router.query.clientId : null;
  const scopeString = typeof router.query.scopes === "string" ? router.query.scopes : "";

  const requestedScopes = useMemo(
    () => scopeString.split(" ").map(s => s.trim()).filter(Boolean),
    [scopeString]
  );

  useEffect(() => {
    if (!router.isReady)
      return;

    if (auth.isLoading)
      return;

    if (!auth.currentUser) {
      router.push(`/auth?redirect=${encodeURIComponent(router.asPath)}`);
      return;
    }

    if (!clientId) {
      setError("Missing client_id parameter.");
      setIsLoading(false);
      return;
    }

    async function loadAppInfo() {
      try {
        const result = await api.developer.getAppByClientId({ clientId: clientId! });

        if (!result.ok) {
          setError(result.message);
          setIsLoading(false);
          return;
        }

        setAppInfo(result.data.app);
        setIsLoading(false);
      }
      catch {
        setError("Unable to load app information.");
        setIsLoading(false);
      }
    }

    loadAppInfo();
  }, [router.isReady, auth.isLoading, auth.currentUser, clientId]);

  const groupedScopes = useMemo(() => {
    const active: Record<string, { scope: string; description: string }[]> = {};

    for (const [groupName, groupScopes] of Object.entries(OAUTH_SCOPE_GROUPS) as [string, Record<string, string>][]) {
      const groupItems = Object.entries(groupScopes)
        .filter(([key]) => requestedScopes.includes(key))
        .map(([key, description]) => ({ scope: key, description }));

      if (groupItems.length > 0) {
        active[groupName] = groupItems;
      }
    }

    active["Extra"] = [{ scope: "extra", description: sillyScope }];

    return active;
  }, [requestedScopes, sillyScope]);

  const hasWriteScopes = requestedScopes.some(x => x.endsWith(":write"));

  async function respond(consent: boolean) {
    if (!appInfo || !clientId)
      return;

    if (consent && appInfo.trustLevel === "UNTRUSTED" && typedName.trim() !== appInfo.name) {
      setError("Please type the app name to continue.");
      return;
    }

    setIsLoading(true);
    setError(null);

    if (!consent) {
      window.history.back();
      return;
    }

    try {
      const result = await api.auth.grantConsent({
        clientId,
        state: "",
        scopes: requestedScopes
      });

      const continueUrl = new URL(`${API_URL}/api/auth/continue`);
      continueUrl.searchParams.set("consentToken", result.token);
      window.location.href = continueUrl.href;
    }
    catch {
      setError("Unable to process authorization.");
      setIsLoading(false);
    }
  }

  return (
    <RootLayout showHeader={false} title={`Authorize ${appInfo?.name ?? "Service"} - Lapse`}>
      <div className="h-full w-full flex justify-center items-center p-8 sm:p-12">
        <div className="w-full max-w-2xl rounded-3xl border border-black shadow-lg p-8 sm:p-10 flex flex-col gap-6">
          {isLoading && (
            <div className="text-center text-muted">
              Preparing authorization...
            </div>
          )}

          {!isLoading && error && (
            <div className="text-center text-red-400">{error}</div>
          )}

          {!isLoading && !error && appInfo && (
            <>
              <div className="flex flex-col text-center">
                <h1 className="text-3xl font-bold">{appInfo.name}</h1>
                <p className="text-lg text-muted">
                  wants access to your Lapse account
                </p>
              </div>

              <div className="rounded-2xl border border-slate bg-dark p-6 flex flex-col gap-4">
                {Object.keys(groupedScopes).length === 0 && (
                  <p className="text-sm text-muted">
                    no scopes were requested. nothing to see here!
                  </p>
                )}

                {Object.entries(groupedScopes).map(([group, items]) => (
                  <div key={group} className="flex flex-col gap-1">
                    <h2 className="text-lg font-semibold">{group}</h2>
                    <ul className="flex flex-col gap-1">
                      {items.map((item) => (
                        <li key={item.scope} className="text-sm text-muted flex gap-2">
                          <span>&bull;</span> <span>{item.description}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {appInfo.trustLevel === "UNTRUSTED" && (
                <Alert icon="important-fill" variant="warning">
                  <p className="font-semibold text-lg">Community app</p>
                  <p>
                    Granting access lets this app act as you. Only proceed if
                    you trust the developer.
                  </p>

                  { hasWriteScopes && <p>This app requests <b>write access</b> to your data.</p> }
                </Alert>
              )}

              {appInfo.trustLevel === "UNTRUSTED" && (
                <div className="flex flex-col gap-2">
                  <label className="text-muted">Type <b>{appInfo.name}</b> to confirm.</label>
                  <TextInput type="text" value={typedName} onChange={setTypedName} />
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  kind="regular"
                  onClick={() => respond(false)}
                  className="flex-1"
                >
                  Deny
                </Button>

                <Button
                  kind="primary"
                  onClick={() => respond(true)}
                  className="flex-1"
                  disabled={
                    appInfo.trustLevel === "UNTRUSTED" &&
                    typedName.trim() !== appInfo.name
                  }
                >
                  Allow
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </RootLayout>
  );
}
