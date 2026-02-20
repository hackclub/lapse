import { useEffect, useState } from "react";

import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";
import { useAuth } from "@/client/hooks/useAuth";
import { trpc } from "@/client/trpc";

type AdminApp = {
  id: string
  name: string
  description: string
  homepageUrl: string
  iconUrl: string
  clientId: string
  scopes: string[]
  redirectUris: string[]
  trustLevel: "UNTRUSTED" | "TRUSTED"
  createdBy: {
    id: string
    handle: string
    displayName: string
  }
  createdAt: string
};

export default function AdminApps() {
  const auth = useAuth(true);
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!auth.currentUser)
      return;

    (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await trpc.developer.getAllApps.query({});

        if (!res.ok) {
          setError(res.message ?? "Unable to load apps.");
          return;
        }

        setApps(res.data.apps);
      }
      catch (err) {
        console.error("(admin/apps) failed to load", err);
        setError("Unable to load apps.");
      }
      finally {
        setIsLoading(false);
      }
    })();
  }, [auth.currentUser]);

  async function updateTrust(appId: string, trustLevel: "UNTRUSTED" | "TRUSTED") {
    setIsUpdating(true);
    setError(null);

    try {
      const res = await trpc.developer.updateAppTrustLevel.mutate({
        id: appId,
        trustLevel
      });

      if (res.ok) {
        setApps(apps.map(app => app.id === appId ? { ...app, trustLevel: res.data.trustLevel } : app));
      }
      else {
        setError(res.message ?? "Unable to update trust.");
      }
    }
    catch (err) {
      console.error("(admin/apps) failed to update", err);
      setError("Unable to update trust.");
    }
    finally {
      setIsUpdating(false);
    }
  }

  return (
    <RootLayout showHeader={true} title="Admin Apps">
      <div className="flex flex-col gap-6 p-8 sm:p-12">
        <div>
          <h1 className="text-3xl font-bold">OAuth Apps</h1>
          <p className="text-muted">Approve verified apps to remove consent warnings.</p>
        </div>

        {error && <div className="text-red-400">{error}</div>}

        {isLoading && <div className="text-muted">Loading apps...</div>}

        <div className="flex flex-col gap-4">
          {apps.map(app => (
            <div key={app.id} className="rounded-2xl border border-slate bg-dark p-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-lg font-semibold">{app.name}</span>
                <span className="text-xs text-muted">Client ID: {app.clientId}</span>
                <span className="text-xs text-muted">Trust: {app.trustLevel}</span>
                <span className="text-xs text-muted">Owner: @{app.createdBy.handle}</span>
              </div>

              <div className="flex gap-3">
                <Button kind="regular" onClick={() => updateTrust(app.id, "UNTRUSTED")} disabled={isUpdating}>Mark Untrusted</Button>
                <Button kind="primary" onClick={() => updateTrust(app.id, "TRUSTED")} disabled={isUpdating}>Mark Trusted</Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </RootLayout>
  );
}
