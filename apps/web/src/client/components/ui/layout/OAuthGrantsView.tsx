import { useEffect, useState } from "react";
import clsx from "clsx";

import { Button } from "@/client/components/ui/Button";
import { useAuth } from "@/client/hooks/useAuth";
import { OAUTH_SCOPE_GROUPS } from "@/shared/oauthScopes";
import { trpc } from "@/client/trpc";

import { WindowedModal } from "@/client/components/ui/WindowedModal";

const groupOrder = ["Timelapses", "Comments", "Profile", "Insights"];

type ServiceGrant = {
  id: string
  serviceClientId: string
  serviceName: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
};

function groupScopes(scopes: string[]) {
  const grouped: Record<string, string[]> = {};

  for (const groupName of groupOrder) {
    const groupScopes = OAUTH_SCOPE_GROUPS[groupName as keyof typeof OAUTH_SCOPE_GROUPS] as Record<string, string>;
    const entries = Object.keys(groupScopes).filter(scope => scopes.includes(scope));
    if (entries.length > 0)
      grouped[groupName] = entries;
  }

  return grouped;
}

export function OAuthGrantsView({ isOpen, setIsOpen }: {
  isOpen: boolean
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const auth = useAuth(false);
  const [grants, setGrants] = useState<ServiceGrant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !auth.currentUser)
      return;

    (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await trpc.developer.getOwnedOAuthGrants.query({});

        if (!res.ok) {
          setError(res.message ?? "Unable to load grants.");
          return;
        }

        setGrants(res.data.grants);
      }
      catch (err) {
        console.error("(OAuthGrantsView) failed to load grants", err);
        setError("Unable to load grants.");
      }
      finally {
        setIsLoading(false);
      }
    })();
  }, [isOpen, auth.currentUser]);

  async function revokeGrant(grantId: string) {
    setIsLoading(true);
    setError(null);

    try {
      const result = await trpc.developer.revokeOAuthGrant.mutate({ grantId });

      if (result.ok) {
        setGrants(grants.filter(grant => grant.id !== grantId));
      }
      else {
        setError(result.message ?? "Unable to revoke grant.");
      }
    }
    catch (err) {
      console.error("(OAuthGrantsView) failed to revoke", err);
      setError("Unable to revoke grant.");
    }
    finally {
      setIsLoading(false);
    }
  }

  return (
    <WindowedModal
      icon="settings"
      title="Connected Services"
      description="Control which services can act on your behalf"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="flex flex-col gap-4">
        {isLoading && (
          <p className="text-muted">Loading connected services...</p>
        )}

        {!isLoading && error && (
          <p className="text-red-400">{error}</p>
        )}

        {!isLoading && !error && grants.length === 0 && (
          <p className="text-muted text-sm">No connected services yet.</p>
        )}

        {!isLoading && !error && grants.length > 0 && (
          <div className="flex flex-col gap-4">
            {grants.map(grant => {
              const grouped = groupScopes(grant.scopes);
              return (
                <div key={grant.id} className={clsx(
                  "border border-slate rounded-2xl bg-dark p-4",
                  "flex flex-col gap-3"
                )}>
                  <div className="flex flex-col">
                    <span className="font-bold text-lg">{grant.serviceName}</span>
                    <span className="text-xs text-muted">Connected {new Date(grant.createdAt).toLocaleDateString()}</span>
                    {grant.lastUsedAt && (
                      <span className="text-xs text-muted">Last used {new Date(grant.lastUsedAt).toLocaleDateString()}</span>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {Object.entries(grouped).map(([group, scopes]) => (
                      <div key={group} className="text-sm">
                        <span className="font-semibold">{group}</span>
                        <ul className="text-muted text-xs mt-1">
                          {scopes.map(scope => {
                            const groupScopes = OAUTH_SCOPE_GROUPS[group as keyof typeof OAUTH_SCOPE_GROUPS] as Record<string, string>;
                            return (
                              <li key={scope}>• {groupScopes[scope]}</li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end">
                    <Button kind="destructive" onClick={() => revokeGrant(grant.id)} className="!px-6">
                      Revoke
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WindowedModal>
  );
}
