import { useState } from "react";
import { TitleBar } from "../components/TitleBar";
import { useAuth } from "../context/AuthContext";
import { useIpcQuery } from "../hooks/useIpc";
import { lapse } from "../lib/desktop";

export function Settings() {
  const { user, logout } = useAuth();
  const { data: version } = useIpcQuery("app:get-version");
  const { data: storagePath } = useIpcQuery("app:get-storage-path");

  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleCheckUpdates = async () => {
    setIsCheckingUpdates(true);
    setUpdateResult(null);
    try {
      const result = await lapse.invoke("app:check-updates");
      if (result.available) {
        setUpdateResult(`Update available: v${result.version}`);
      } else {
        setUpdateResult("You're on the latest version");
      }
    } catch {
      setUpdateResult("Failed to check for updates");
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      <TitleBar />
      <main className="flex-1 overflow-y-auto bg-neutral-950 p-6">
        <h1 className="mb-6 text-lg font-bold text-white">Settings</h1>

        <div className="mx-auto max-w-lg space-y-6">
          {/* Account */}
          <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-sm font-medium text-neutral-300">Account</h2>
            {user && (
              <div className="flex items-center gap-3">
                {user.pictureUrl ? (
                  <img
                    src={user.pictureUrl}
                    alt={user.handle}
                    className="h-10 w-10 rounded-full"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-700 text-sm font-medium text-white">
                    {(user.displayName ?? user.handle).charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-white">
                    {user.displayName ?? user.handle}
                  </p>
                  <p className="text-xs text-neutral-400">@{user.handle}</p>
                </div>
              </div>
            )}
          </section>

          {/* Storage */}
          <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-sm font-medium text-neutral-300">Storage</h2>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-neutral-500">Storage Location</p>
                <p className="mt-1 truncate font-mono text-sm text-neutral-300">
                  {storagePath ?? "..."}
                </p>
              </div>
            </div>
          </section>

          {/* Updates */}
          <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-4 text-sm font-medium text-neutral-300">Updates</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-neutral-300">App Version</p>
                <p className="text-xs text-neutral-500">{version ?? "..."}</p>
              </div>
              <button
                type="button"
                onClick={handleCheckUpdates}
                disabled={isCheckingUpdates}
                className="rounded-lg bg-neutral-800 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
              >
                {isCheckingUpdates ? "Checking..." : "Check for Updates"}
              </button>
            </div>
            {updateResult && (
              <p className="mt-3 text-xs text-neutral-400">{updateResult}</p>
            )}
          </section>

          {/* Sign out */}
          <section className="rounded-xl border border-red-500/20 bg-neutral-900 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-neutral-300">Sign Out</h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  This will remove your session from this device
                </p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                {isLoggingOut ? "Signing out..." : "Sign Out"}
              </button>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
