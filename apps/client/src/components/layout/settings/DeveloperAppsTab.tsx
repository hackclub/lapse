import { useEffect, useMemo, useState } from "react";
import Icon from "@hackclub/icons";
import { OAuthApp, OAUTH_SCOPE_GROUPS } from "@hackclub/lapse-api";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { TextInput } from "@/components/ui/TextInput";
import { TextareaInput } from "@/components/ui/TextareaInput";
import { WindowedModal } from "@/components/layout/WindowedModal";

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

function AppCard({ app, onEdit, onRotate, onDelete }: {
  app: OAuthApp;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const testUrl = buildAuthorizeTestUrl(app);

  return (
    <div className="rounded-2xl border border-slate bg-darker p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {app.iconUrl ? (
            <img src={app.iconUrl} alt="" className="w-10 h-10 rounded-lg shrink-0 object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-lg shrink-0 bg-darkless border border-slate flex items-center justify-center">
              <Icon glyph="code" size={24} className="text-muted" />
            </div>
          )}

          <div className="min-w-0">
            <h3 className="font-bold text-lg truncate">{app.name}</h3>
            {app.description && (
              <p className="text-muted text-sm truncate">{app.description}</p>
            )}
          </div>
        </div>

        <Badge variant={app.trustLevel === "TRUSTED" ? "success" : "warning"}>
          {app.trustLevel === "TRUSTED" ? "Trusted" : "Untrusted"}
        </Badge>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <span className="text-muted">Client ID</span>
        <code className="font-mono text-muted">{app.clientId}</code>

        <span className="text-muted">Scopes</span>
        <span className="font-mono text-muted">{app.scopes.join(", ")}</span>

        {app.redirectUris.length > 0 && (
          <>
            <span className="text-muted">Redirect</span>
            <span className="font-mono text-muted truncate">{app.redirectUris.join(", ")}</span>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-3 border-t border-slate">
        <Button kind="regular" onClick={onEdit} icon="edit" className="py-3!">
          Edit
        </Button>

        <Button
          kind="regular"
          href={testUrl ?? "#"}
          disabled={testUrl == null}
          icon="flag"
          className="py-3!"
        >
          Test Auth
        </Button>

        <Button kind="regular" onClick={onRotate} icon="view-reload" className="py-3!">
          Rotate Secret
        </Button>

        <div className="flex-1" />

        <Button kind="destructive" onClick={onDelete} icon={<Icon glyph="delete" size={20} />} />
      </div>
    </div>
  );
}

export function DeveloperAppsTab({ isVisible }: { isVisible: boolean }) {
  const auth = useAuth(false);
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
    if (!isVisible || !auth.currentUser)
      return;

    (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await api.developer.getAllOwnedApps({});

        if (!res.ok) {
          setError(`Unable to load apps: ${res.message}`);
          return;
        }

        setApps(res.data.apps);
      }
      catch (err) {
        console.error("(DeveloperAppsTab) failed to load", err);
        setError("Unable to load apps.");
      }
      finally {
        setIsLoading(false);
      }
    })();
  }, [isVisible, auth.currentUser]);

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
      const res = await api.developer.createApp({
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
      console.error("(DeveloperAppsTab) failed to create", err);
      setError("Unable to create app.");
    }
  }

  async function deleteApp(appId: string) {
    setError(null);

    try {
      const res = await api.developer.revokeApp({ id: appId });
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
      console.error("(DeveloperAppsTab) failed to delete", err);
      setError("Unable to delete app.");
    }
  }

  async function rotateSecret(appId: string) {
    setError(null);

    try {
      const res = await api.developer.rotateAppSecret({ id: appId });

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
      console.error("(DeveloperAppsTab) failed to rotate secret", err);
      setError("Unable to rotate secret.");
    }
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

  async function saveEdit() {
    if (!appModalId)
      return;

    setError(null);
    setSaveNotice(null);

    try {
      const res = await api.developer.updateApp({
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
      console.error("(DeveloperAppsTab) failed to update", err);
      setError("Unable to update app.");
    }
  }

  function openCreateModal() {
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
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <p className="text-muted">
          If you need a program key instead, message us at{" "}
          <a href="https://hackclub.enterprise.slack.com/archives/C0AH74J112T" target="_blank" rel="noopener noreferrer" className="text-red hover:underline">#lapse-dev</a>!
        </p>

        <Button kind="primary" onClick={openCreateModal}>
          Create App
        </Button>
      </div>

      {error && <div className="text-red">{error}</div>}
      {saveNotice && <div className="text-emerald-300">{saveNotice}</div>}

      {secretResult && (
        <div className="rounded-2xl border border-red bg-darker p-4 flex flex-col gap-2">
          <p className="font-semibold text-red">Client secret &mdash; copy it now, it won&apos;t be shown again!</p>
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted shrink-0">Client ID</span>
              <code className="font-mono bg-darkless rounded px-2 py-0.5">{secretResult.clientId}</code>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted shrink-0">Secret</span>
              <code className="font-mono bg-darkless rounded px-2 py-0.5 break-all">{secretResult.clientSecret}</code>
            </div>
          </div>
        </div>
      )}

      {isLoading && <p className="text-muted">Loading apps...</p>}

      {!isLoading && apps.length === 0 && (
        <p className="text-muted text-center">No apps yet.</p>
      )}

      {!isLoading && apps.length > 0 && (
        <div className="flex flex-col gap-3">
          {apps.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              onEdit={() => beginEdit(app)}
              onRotate={() => setRotateSecretId(app.id)}
              onDelete={() => setDeleteConfirmId(app.id)}
            />
          ))}
        </div>
      )}

      <WindowedModal
        icon={appModalMode === "create" ? "plus" : "edit"}
        title={appModalMode === "create" ? "Create App" : "Edit App"}
        description={appModalMode === "create" ? "Register a new OAuth application" : "Update your app configuration"}
        isOpen={appModalOpen}
        setIsOpen={setAppModalOpen}
      >
        <div className="flex flex-col gap-5">
          <TextInput
            field={{ label: "App Name", description: "A display name for your application.", icon: "flag" }}
            value={formState.name}
            onChange={(v) => setFormState({ ...formState, name: v })}
            placeholder="My App"
          />

          <TextInput
            field={{ label: "Homepage URL", description: "Where users can learn about your app.", icon: "web" }}
            value={formState.homepageUrl}
            onChange={(v) => setFormState({ ...formState, homepageUrl: v })}
            placeholder="https://example.com"
            mono
          />

          <TextareaInput
            label="Description"
            description="A short summary shown during OAuth consent."
            icon="post"
            value={formState.description}
            onChange={(v) => setFormState({ ...formState, description: v })}
          />

          <TextInput
            field={{ label: "Icon URL", description: "Optional icon shown during OAuth consent.", icon: "photo" }}
            value={formState.iconUrl}
            onChange={(v) => setFormState({ ...formState, iconUrl: v })}
            placeholder="https://example.com/icon.png"
            mono
          />

          <TextareaInput
            label="Redirect URIs"
            description={appModalMode === "edit"
              ? "One per line. Must match the homepage domain."
              : "One per line. Where users are sent after authorization."}
            icon="link"
            mono
            value={formState.redirectUris}
            onChange={(v) => setFormState({ ...formState, redirectUris: v })}
          />

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Icon glyph="private" size={24} className="text-muted shrink-0" />
              <label className="font-bold">Scopes</label>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-6 shrink-0" />
              <div className="flex flex-col w-full">
                <p className="text-muted mb-3">Permissions your app can request during authorization.</p>

                <div className="flex flex-col gap-2">
              {scopeEntries.map((scope) => (
                <Checkbox
                  key={scope.key}
                  label={scope.key}
                  monoLabel
                  inline
                  description={scope.description}
                  checked={formState.scopes.includes(scope.key)}
                  onChange={(checked) => {
                    const next = checked
                      ? [...formState.scopes, scope.key]
                      : formState.scopes.filter((item) => item !== scope.key);
                    setFormState({ ...formState, scopes: next });
                  }}
                />
              ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              kind="regular"
              onClick={() => { setAppModalOpen(false); setAppModalMode("create"); setAppModalId(null); }}
              className="flex-1"
            >
              Cancel
            </Button>

            <Button
              kind="primary"
              onClick={() => appModalMode === "create" ? createApp() : saveEdit()}
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
          <p className="text-muted">
            Deleting this app will revoke all grants and disable OAuth flows.
          </p>

          <div className="flex gap-2">
            <Button kind="regular" onClick={() => setDeleteConfirmId(null)} className="flex-1">Cancel</Button>
            <Button kind="destructive" onClick={() => deleteConfirmId && deleteApp(deleteConfirmId)} className="flex-1">Delete App</Button>
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
          <p className="text-muted">
            Rotating the secret will invalidate the existing secret immediately.
          </p>

          <div className="flex gap-2">
            <Button kind="regular" onClick={() => setRotateSecretId(null)} className="flex-1">Cancel</Button>
            <Button kind="primary" onClick={() => rotateSecretId && rotateSecret(rotateSecretId)} className="flex-1">Rotate Secret</Button>
          </div>
        </div>
      </WindowedModal>
    </div>
  );
}
