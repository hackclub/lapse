import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { DesktopLinkError, listLinkedDesktops, revokeLinkedDesktop, type LinkedDesktop } from "@/components/lookout/desktopLink";

export default function LookoutDevicesPage() {
  const router = useRouter();
  const { currentUser, isLoading } = useAuth(false);
  const [devices, setDevices] = useState<LinkedDesktop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading)
      return;
    if (!currentUser || currentUser.private.needsReauth) {
      router.replace(`/auth?redirect=${encodeURIComponent("/lookout/devices")}`);
    }
  }, [isLoading, currentUser, router]);

  useEffect(() => {
    if (!currentUser)
      return;
    let cancelled = false;
    listLinkedDesktops()
      .then(rows => { if (!cancelled) setDevices(rows); })
      .catch(err => {
        if (cancelled)
          return;
        if (err instanceof DesktopLinkError && err.status === 401) {
          router.replace(`/auth?redirect=${encodeURIComponent("/lookout/devices")}`);
          return;
        }
        setError(err instanceof Error ? err.message : "Couldn't load devices");
        setDevices([]);
      });
    return () => { cancelled = true; };
  }, [currentUser, router]);

  async function revoke(id: string) {
    setRevoking(id);
    setError(null);
    try {
      await revokeLinkedDesktop(id);
      setDevices(current => current?.filter(device => device.id !== id) ?? []);
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't revoke that device");
    }
    finally {
      setRevoking(null);
    }
  }

  return (
    <RootLayout title="Linked Lookout devices - Lapse">
      <div className="h-full flex flex-col items-center px-8 py-16 bg-grid-gradient-up">
        <div className="flex flex-col gap-4 max-w-md w-full">
          <h1 className="text-3xl font-bold tracking-tight">Linked devices</h1>
          <p className="text-smoke text-pretty">
            These Lookout installs can start a recording on your account. Revoking one makes it ask to link again.
          </p>
          {error && <p className="text-red">{error}</p>}
          {devices === null && <p className="text-smoke">Loading...</p>}
          {devices?.length === 0 && <p className="text-smoke">No Lookout devices are linked.</p>}
          <ul className="flex flex-col gap-3">
            {devices?.map(device => (
              <li key={device.id} className="flex items-center justify-between gap-4">
                <span>
                  <span className="font-bold">{device.label}</span>
                  <span className="block text-smoke text-sm">{new Date(device.createdAt).toLocaleString()}</span>
                </span>
                <Button
                  kind="destructive"
                  disabled={revoking === device.id}
                  onClick={() => { void revoke(device.id); }}
                >
                  {revoking === device.id ? "Revoking..." : "Revoke"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </RootLayout>
  );
}
