import type { GetServerSideProps } from "next";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";

import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";

export const getServerSideProps: GetServerSideProps = async () => {
  if (process.env.NODE_ENV === "production") return { notFound: true };

  return { props: {} };
};

export default function OAuthAuthorizeTest() {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [scope, setScope] = useState("timelapse:read");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);

  const authorizeUrl = useMemo(() => {
    const params = new URLSearchParams();

    if (clientId.trim()) params.set("client_id", clientId.trim());
    if (redirectUri.trim()) params.set("redirect_uri", redirectUri.trim());
    if (scope.trim()) params.set("scope", scope.trim());
    if (state.trim()) params.set("state", state.trim());

    const query = params.toString();
    return query ? `/oauth/authorize?${query}` : "/oauth/authorize";
  }, [clientId, redirectUri, scope, state]);

  function openAuthorizePage() {
    if (!clientId.trim()) {
      setError("Client ID is required.");
      return;
    }

    if (!redirectUri.trim()) {
      setError("Redirect URI is required.");
      return;
    }

    setError(null);
    router.push(authorizeUrl);
  }

  return (
    <RootLayout showHeader={true} title="OAuth Authorize Tester">
      <div className="min-h-[60vh] w-full flex justify-center items-center p-8 sm:p-12">
        <div className="w-full max-w-2xl rounded-3xl border border-black bg-darkless shadow-lg p-8 sm:p-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold">Test OAuth Authorization</h1>
            <p className="text-muted">
              Build a request for the authorization screen in development.
            </p>
          </div>

          {error && <div className="text-center text-red-400">{error}</div>}

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm text-muted">
              Client ID
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className="rounded-xl border border-slate bg-dark px-4 py-2"
                placeholder="svc_..."
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Redirect URI
              <input
                value={redirectUri}
                onChange={(event) => setRedirectUri(event.target.value)}
                className="rounded-xl border border-slate bg-dark px-4 py-2"
                placeholder="https://example.com/callback"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              Scopes (space-separated)
              <input
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                className="rounded-xl border border-slate bg-dark px-4 py-2"
                placeholder="timelapse:read snapshot:read"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-muted">
              State (optional)
              <input
                value={state}
                onChange={(event) => setState(event.target.value)}
                className="rounded-xl border border-slate bg-dark px-4 py-2"
                placeholder="optional state string"
              />
            </label>
          </div>

          <div className="flex flex-col gap-3">
            <Button kind="primary" onClick={openAuthorizePage}>
              Open authorize page
            </Button>
            <div className="text-xs text-muted break-all">
              {authorizeUrl}
            </div>
          </div>
        </div>
      </div>
    </RootLayout>
  );
}
