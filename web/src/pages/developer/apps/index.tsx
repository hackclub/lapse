import { useEffect, useMemo, useState } from "react";
import Icon from "@hackclub/icons";

import { OAuthApp } from "@/client/api";
import { trpc } from "@/client/trpc";
import { useAuth } from "@/client/hooks/useAuth";
import { Button } from "@/client/components/ui/Button";
import { WindowedModal } from "@/client/components/ui/WindowedModal";
import RootLayout from "@/client/components/RootLayout";

import { OAUTH_SCOPE_GROUPS } from "@/shared/oauthScopes";

const scopeEntries = Object.entries(OAUTH_SCOPE_GROUPS).flatMap(
  ([group, scopes]) =>
    Object.entries(scopes).map(([key, description]) => ({
      group,
      key,
      description,
    })),
);

function buildAuthorizeTestUrl(app: OAuthApp) {
  const redirectUri = app.redirectUris[0];
  if (!redirectUri)
    return null;

  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
  });

  if (app.scopes.length > 0) {
    params.set("scope", app.scopes.join(" "));
  }

  return `/oauth/authorize?${params.toString()}`;
}

export default function DeveloperApps() {
  const auth = useAuth(true);
  const [apps, setApps] = useState<OAuthApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [formState, setFormState] = useState({
    name: "",
    description: "",
    homepageUrl: "",
    iconUrl: "",
    redirectUris: "",
    scopes: scopeEntries.map((scope) => scope.key),
  });

  const [secretResult, setSecretResult] = useState<{ clientId: string; clientSecret: string } | null>(null);

  const [appModalOpen, setAppModalOpen] = useState(false);
  const [appModalMode, setAppModalMode] = useState<"create" | "edit">("create");
  const [appModalId, setAppModalId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [rotateSecretId, setRotateSecretId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.currentUser)
      return;

    (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await trpc.developer.getAllOwnedApps.query({});

        if (!res.ok) {
          setError(`Unable to load apps: ${res.message}`);
          return;
        }

        setApps(res.data.apps);
      }
      catch (err) {
        console.error("(developer/apps) failed to load", err);
        setError("Unable to load apps.");
      }
      finally {
        setIsLoading(false);
      }
    })();
  }, [auth.currentUser]);

  const modalRedirectUris = useMemo(
    () => formState.redirectUris
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [formState.redirectUris]
  );

  async function createApp() {
    setError(null);
    setSecretResult(null);

    try {
      const res = await trpc.developer.createApp.mutate({
        name: formState.name,
        description: formState.description,
        homepageUrl: formState.homepageUrl,
        iconUrl: formState.iconUrl,
        redirectUris: modalRedirectUris,
        scopes: formState.scopes
      });

      if (!res.ok) {
        setError(`Unable to create app: ${res.message}`);
        return;
      }

      setApps([res.data.app, ...apps]);
      setSecretResult({
        clientId: res.data.app.clientId,
        clientSecret: res.data.clientSecret,
      });

      setFormState({
        name: "",
        description: "",
        homepageUrl: "",
        iconUrl: "",
        redirectUris: "",
        scopes: formState.scopes,
      });

      setAppModalOpen(false);
    }
    catch (err) {
      console.error("(developer/apps) failed to create", err);
      setError("Unable to create app.");
    }
  }

  async function deleteApp(appId: string) {
    setError(null);

    try {
      const res = await trpc.developer.revokeApp.mutate({ id: appId });
      if (!res.ok) {
        setError(`Unable to delete app: ${res.message}`);
        return;
      }

      setApps(apps.filter((app) => app.id !== appId));
      setDeleteConfirmId(null);

      if (appModalId === appId) {
        setAppModalOpen(false);
        setAppModalMode("create");
        setAppModalId(null);
      }
    }
    catch (err) {
      console.error("(developer/apps) failed to delete", err);
      setError("Unable to delete app.");
    }
  }

  function confirmDeleteApp(appId: string) {
    setDeleteConfirmId(appId);
  }

  async function rotateSecret(appId: string) {
    setError(null);

    try {
      const res = await trpc.developer.rotateAppSecret.mutate({ id: appId });

      if (!res.ok) {
        setError(`Unable to rotate secret: ${res.message}`);
        return;
      }

      const app = apps.find(x => x.id === appId);
      if (!app)
        return;

      setSecretResult({
        clientId: app.clientId,
        clientSecret: res.data.clientSecret,
      });

      setRotateSecretId(null);
    }
    catch (err) {
      console.error("(developer/apps) failed to rotate secret", err);
      setError("Unable to rotate secret.");
    }
  }

  function confirmRotateSecret(appId: string) {
    setRotateSecretId(appId);
  }

  function beginEdit(app: OAuthApp) {
    setAppModalMode("edit");
    setAppModalId(app.id);
    setFormState({
      name: app.name,
      description: app.description,
      homepageUrl: app.homepageUrl,
      iconUrl: app.iconUrl,
      redirectUris: app.redirectUris.join("\n"),
      scopes: app.scopes,
    });

    setAppModalOpen(true);
  }

  function cancelEdit() {
    setAppModalOpen(false);
    setAppModalMode("create");
    setAppModalId(null);
  }

  async function saveEdit() {
    if (!appModalId)
      return;

    setError(null);
    setSaveNotice(null);

    try {
      const res = await trpc.developer.updateApp.mutate({
        id: appModalId,
        name: formState.name,
        description: formState.description,
        homepageUrl: formState.homepageUrl,
        iconUrl: formState.iconUrl,
        redirectUris: modalRedirectUris,
        scopes: formState.scopes
      });

      if (!res.ok) {
        setError(`Unable to update app: ${res.message}`);
        return;
      }

      setApps(apps.map(x => x.id === appModalId ? res.data.app : x));
      setSaveNotice("App updated. Existing authorizations remain active.");
      setAppModalOpen(false);
      setAppModalMode("create");
      setAppModalId(null);
    }
    catch (err) {
      console.error("(developer/apps) failed to update", err);
      setError("Unable to update app.");
    }
  }

  return (
    <RootLayout showHeader={true} title="Developer Apps">
      <div className="flex flex-col gap-8 px-16 py-4 sm:px-24">
        <div className="flex justify-between">
          <div className="flex items-center gap-4">
            <Icon glyph="code" width={48} height={48} className="flex-shrink-0" />

            <div>
              <h1 className="text-3xl font-bold">Developer Apps</h1>
              <p className="text-muted">
                Register an OAuth app for Lapse. Untrusted apps show a warning
                during consent.
              </p>
            </div>
          </div>

          <Button
            kind="primary"
            onClick={() => {
              setAppModalMode("create");
              setFormState({
                name: "",
                description: "",
                homepageUrl: "",
                iconUrl: "",
                redirectUris: "",
                scopes: scopeEntries.map((scope) => scope.key),
              });
              setAppModalOpen(true);
            }}
          >
            Create App
          </Button>
        </div>

        {error && <div className="text-red-400">{error}</div>}
        {saveNotice && <div className="text-emerald-300">{saveNotice}</div>}

        {secretResult && (
          <div className="rounded-2xl border border-red bg-dark p-6 text-red-200">
            <p className="font-semibold text-lg">This is your client secret for your new app - it won't be shown again!</p>
            <p>
              Client ID:{" "}
              <span className="font-mono">{secretResult.clientId}</span>
            </p>
            <p>
              Client Secret:{" "}
              <span className="font-mono">{secretResult.clientSecret}</span>
            </p>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {isLoading && <p className="text-muted">Loading apps...</p>}

          {!isLoading && apps.length === 0 && (
            <p className="text-muted">No apps yet.</p>
          )}

          {!isLoading && apps.length > 0 && (
            <div className="flex flex-col gap-4">
              {apps.map((app) => (
                <div
                  key={app.id}
                  className="rounded-2xl border border-slate bg-dark px-8 py-4 flex flex-col gap-3"
                >
                  <div className="flex flex-col">
                    <span className="text-lg font-semibold">{app.name}</span>
                    <span className="text-muted">Client ID: <span className="font-mono">{app.clientId}</span></span>
                    <span className="text-muted">Trust level: <span className="font-mono">{app.trustLevel}</span></span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      kind="regular"
                      onClick={() => beginEdit(app)}
                      className="w-fit"
                      icon="edit"
                    >
                      Edit App
                    </Button>

                    <Button
                      kind="regular"
                      href={buildAuthorizeTestUrl(app) ?? "#"}
                      disabled={buildAuthorizeTestUrl(app) == null}
                      className="w-fit"
                      icon="flag"
                    >
                      Test Auth
                    </Button>

                    <Button
                      kind="regular"
                      onClick={() => confirmRotateSecret(app.id)}
                      className="w-fit"
                      icon="view-reload"
                    >
                      Rotate Secret
                    </Button>
                    <Button
                      kind="destructive"
                      onClick={() => confirmDeleteApp(app.id)}
                      className="w-fit"
                      icon="delete"
                    >
                      Delete App
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <WindowedModal
          icon="plus"
          title={appModalMode === "create" ? "Create App" : "Edit App"}
          description="Configure your app details"
          isOpen={appModalOpen}
          setIsOpen={setAppModalOpen}
        >
          <div className="flex flex-col gap-4">
            <input
              value={formState.name}
              onChange={(event) =>
                setFormState({ ...formState, name: event.target.value })
              }
              placeholder="App name"
              className="rounded-xl border border-slate bg-dark px-4 py-2"
            />

            <input
              value={formState.homepageUrl}
              onChange={(event) =>
                setFormState({ ...formState, homepageUrl: event.target.value })
              }
              placeholder="Homepage URL"
              className="rounded-xl border border-slate bg-dark px-4 py-2"
            />

            <textarea
              value={formState.description}
              onChange={(event) =>
                setFormState({ ...formState, description: event.target.value })
              }
              placeholder="Description"
              className="rounded-xl border border-slate bg-dark px-4 py-2 min-h-22.5"
            />

            <input
              value={formState.iconUrl}
              onChange={(event) =>
                setFormState({ ...formState, iconUrl: event.target.value })
              }
              placeholder="Icon URL (optional)"
              className="rounded-xl border border-slate bg-dark px-4 py-2"
            />

            <textarea
              value={formState.redirectUris}
              onChange={(event) =>
                setFormState({ ...formState, redirectUris: event.target.value })
              }
              placeholder="Redirect URIs (one per line)"
              className="rounded-xl border border-slate bg-dark px-4 py-2 min-h-22.5"
            />

            {appModalMode === "edit" && appModalId && (
              <div className="text-xs text-muted">
                Redirect URIs must match the homepage domain.
              </div>
            )}

            <div className="rounded-2xl border border-slate bg-dark p-4 flex flex-col gap-2">
              <h3 className="text-lg font-semibold">Scopes</h3>
              {scopeEntries.map((scope) => (
                <label
                  key={scope.key}
                  className="flex gap-2 text-sm text-muted"
                >
                  <input
                    type="checkbox"
                    checked={formState.scopes.includes(scope.key)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...formState.scopes, scope.key]
                        : formState.scopes.filter((item) => item !== scope.key);
                      setFormState({ ...formState, scopes: next });
                    }}
                  />
                  <span>
                    {scope.group}: {scope.description}
                  </span>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <Button
                kind="regular"
                onClick={() => cancelEdit()}
                className="flex-1"
              >
                Cancel
              </Button>

              <Button
                kind="primary"
                onClick={() =>
                  appModalMode === "create" ? createApp() : saveEdit()
                }
                className="flex-1"
              >
                {appModalMode === "create" ? "Create App" : "Save Changes"}
              </Button>
            </div>
          </div>
        </WindowedModal>

        <WindowedModal
          icon="delete"
          title="Delete App"
          description="This action cannot be undone"
          isOpen={!!deleteConfirmId}
          setIsOpen={(open) => !open && setDeleteConfirmId(null)}
        >
          <div className="flex flex-col gap-4">
            <p className="text-muted text-sm">
              Deleting this app will revoke all grants and disable OAuth flows.
            </p>

            <div className="flex gap-2">
              <Button
                kind="regular"
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1"
              >
                Cancel
              </Button>

              <Button
                kind="destructive"
                onClick={() => deleteConfirmId && deleteApp(deleteConfirmId)}
                className="flex-1"
              >
                Delete App
              </Button>
            </div>
          </div>
        </WindowedModal>

        <WindowedModal
          icon="announcement"
          title="Rotate Client Secret"
          description="This will invalidate the existing client secret"
          isOpen={!!rotateSecretId}
          setIsOpen={(open) => !open && setRotateSecretId(null)}
        >
          <div className="flex flex-col gap-4">
            <p className="text-muted text-sm">
              Rotating the secret will invalidate the existing secret
              immediately.
            </p>

            <div className="flex gap-2">
              <Button
                kind="regular"
                onClick={() => setRotateSecretId(null)}
                className="flex-1"
              >
                Cancel
              </Button>
              
              <Button
                kind="primary"
                onClick={() => rotateSecretId && rotateSecret(rotateSecretId)}
                className="flex-1"
              >
                Rotate Secret
              </Button>
            </div>
          </div>
        </WindowedModal>
      </div>
    </RootLayout>
  );
}
