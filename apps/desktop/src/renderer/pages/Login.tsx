import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { lapse } from "../lib/desktop";

export function Login() {
  const { login, isLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [tokenValue, setTokenValue] = useState("");

  const handleLogin = async () => {
    setError(null);
    try {
      await login();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in");
    }
  };

  const handlePasteToken = async () => {
    if (!tokenValue.trim()) return;
    setError(null);
    try {
      const { success } = await lapse.invoke("auth:set-token", tokenValue.trim());
      if (success) {
        window.location.reload();
      } else {
        setError("Failed to set token");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set token");
    }
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-neutral-950 px-8">
      {/* Logo / Branding */}
      <div className="mb-8 text-center">
        <div className="mb-4 flex items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-600">
            <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" />
              <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none" />
            </svg>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white">Lapse</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Screen recording timelapses for Hackatime
        </p>
      </div>

      {/* Sign in card */}
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <button
          type="button"
          onClick={handleLogin}
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <svg
                className="h-4 w-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Signing in...
            </>
          ) : (
            "Sign in with Hackatime"
          )}
        </button>

        {error && (
          <p className="mt-3 text-center text-xs text-red-400">{error}</p>
        )}
      </div>

      {/* Dev: paste token */}
      <div className="mt-6">
        {!showTokenInput ? (
          <button
            type="button"
            onClick={() => setShowTokenInput(true)}
            className="text-xs text-neutral-600 transition-colors hover:text-neutral-400"
          >
            Dev: paste token from web client
          </button>
        ) : (
          <div className="w-full max-w-sm space-y-2">
            <p className="text-xs text-neutral-500">
              Open lapse.hackclub.com, press F12, run:{" "}
              <code className="rounded bg-neutral-800 px-1 py-0.5">
                localStorage.getItem("lapse:token")
              </code>
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={tokenValue}
                onChange={e => setTokenValue(e.target.value)}
                placeholder="Paste token here..."
                className="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-white placeholder-neutral-500 outline-none focus:border-neutral-500"
              />
              <button
                type="button"
                onClick={handlePasteToken}
                disabled={!tokenValue.trim()}
                className="rounded-lg bg-neutral-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-600 disabled:opacity-50"
              >
                Go
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
