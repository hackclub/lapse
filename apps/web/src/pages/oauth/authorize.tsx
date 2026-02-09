import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";

import { useAuth } from "@/client/hooks/useAuth";
import { OAUTH_SCOPE_GROUPS } from "@/shared/oauthScopes";
import Icon from "@hackclub/icons";

type ServiceInfo = {
  id: string;
  name: string;
  clientId: string;
  scopes: string[];
  redirectUris: string[];
  trustLevel?: "TRUSTED" | "UNTRUSTED";
};

const EXTRA_IMPORTANT_SCOPES = [
  "Order a thousand pizzas",
  "Summon evil ascpixi",
  "Post in #meta",
  "Headpat heidi",
  "Fly to hq",
  "Adopt every single cat EVER",
  "Push to prod",
  'upaospsasopsaos "Orpheus" opasopaosossdsospsdaspspasxp',
];

export default function OAuthAuthorize() {
  const router = useRouter();
  const auth = useAuth(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState<ServiceInfo | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [typedName, setTypedName] = useState("");
  const [requestedScopes, setRequestedScopes] = useState<string[]>([]);
  const [trustLevel, setTrustLevel] = useState<"TRUSTED" | "UNTRUSTED" | null>(null);
  const [extraScope, setExtraScope] = useState(
    EXTRA_IMPORTANT_SCOPES[
      Math.floor(Math.random() * EXTRA_IMPORTANT_SCOPES.length)
    ],
  );

  const { client_id, scope, redirect_uri, state } = router.query;
  const resolvedRedirectUri = typeof redirect_uri === "string" ? redirect_uri : undefined;

  useEffect(() => {
    if (!router.isReady)
      return;

    if (!auth.currentUser && !auth.isLoading) {
      router.push(`/auth?error=oauth-login-required&redirect=${encodeURIComponent(router.asPath)}`);
      return;
    }

    const scopeString = typeof scope === "string" ? scope : "";
    const scopesRequested = scopeString
      .split(" ")
      .map((item) => item.trim())
      .filter(Boolean);

    setRequestedScopes(scopesRequested);
    setScopes(scopesRequested);

    async function loadService() {
      try {
        const response = await fetch("/api/oauth/authorize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id,
            redirect_uri: resolvedRedirectUri,
            scope: scopesRequested,
            state,
          }),
        });

        const data = await response.json();
        if (!response.ok || !data.ok) {
          setError(data?.message ?? "Unable to validate client.");
          setIsLoading(false);
          return;
        }

        if (data.data.redirectUrl) {
          window.location.href = data.data.redirectUrl;
          return;
        }

        setService(data.data.client);
        setTrustLevel(data.data.client.trustLevel ?? null);
        setIsLoading(false);
        setError(null);
      }
      catch (err) {
        console.error("(oauth/authorize) failed to load service", err);
        setError("Unable to validate the service.");
        setIsLoading(false);
      }
    }

    loadService();
  }, [
    router.isReady,
    router.push,
    router.asPath,
    auth.currentUser,
    auth.isLoading,
    client_id,
    scope,
    resolvedRedirectUri,
    state,
  ]);

  const groupedScopes = useMemo(() => {
    const active: Record<string, { scope: string; description: string }[]> = {};

    for (const [groupName, groupScopes] of Object.entries(OAUTH_SCOPE_GROUPS) as [string, Record<string, string>][]) {
      const groupItems = Object.entries(groupScopes)
        .filter(([key]) => scopes.includes(key))
        .map(([key, description]) => ({ scope: key, description }));

      if (groupItems.length > 0) {
        active[groupName] = groupItems;
      }
    }

    active["Extra"] = [{ scope: "extra", description: extraScope }];

    return active;
  }, [scopes, extraScope]);

  const hasWriteScopes = requestedScopes.some(x => x.endsWith(":write"),);

  async function respond(consent: boolean) {
    if (!service)
      return;

    if (consent && trustLevel === "UNTRUSTED" && typedName.trim() !== service.name) {
      setError("Please type the app name to continue.");
      return;
    }

    setIsLoading(true);

    const response = await fetch("/api/oauth/authorize", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: service.clientId,
        redirect_uri: resolvedRedirectUri,
        scope: scopes,
        state,
        consent,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      setError(data?.message ?? "Unable to process authorization.");
      setIsLoading(false);
      return;
    }

    if (data.data.redirectUrl) {
      window.location.href = data.data.redirectUrl;
      return;
    }

    setIsLoading(false);
  }

  return (
    <RootLayout showHeader={false} title={`Authorize ${service?.name ?? "Service"} - Lapse`}>
      <div className="min-h-[60vh] w-full flex justify-center items-center p-8 sm:p-12">
        <div className="w-full max-w-2xl rounded-3xl border border-black bg-darkless shadow-lg p-8 sm:p-10 flex flex-col gap-6">
          {isLoading && (
            <div className="text-center text-muted">
              Preparing authorization...
            </div>
          )}

          {!isLoading && error && (
            <div className="text-center text-red-400">{error}</div>
          )}

          {!isLoading && !error && service && (
            <>
              <div className="flex flex-col text-center">
                <h1 className="text-3xl font-bold">{service.name}</h1>
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

              {trustLevel === "UNTRUSTED" && (
                <div className="rounded-2xl border border-red bg-dark p-4 text-sm text-red-300 flex items-center gap-4">
                  <Icon glyph="important-fill" size={48} className="h-full" />

                  <div className="">
                    <p className="font-semibold text-lg">Community app</p>
                    <p>
                      Granting access lets this app act as you. Only proceed if
                      you trust the developer.
                    </p>
                    {hasWriteScopes && (
                      <p>
                        This app requests <b>write access</b> to your data.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {trustLevel === "UNTRUSTED" && (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="app-name-confirm"
                    className="text-muted"
                  >
                    Type <b>{service.name}</b> to confirm.
                  </label>

                  <input
                    id="app-name-confirm"
                    type="text"
                    value={typedName}
                    onChange={(event) => setTypedName(event.target.value)}
                    className="rounded-xl border border-slate bg-dark px-4 py-2"
                  />
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
                    trustLevel === "UNTRUSTED" &&
                    typedName.trim() !== service.name
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
