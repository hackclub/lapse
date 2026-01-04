import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { matchOrDefault } from "@/shared/common";

import RootLayout from "@/client/components/RootLayout";

export default function Auth() {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "error">("loading");

  useEffect(() => {
    async function initOAuth() {
      try {
        const response = await fetch("/api/auth-hackatime-init", {
          method: "POST",
        });

        if (!response.ok) {
          setStatus("error");
          router.push("/?error=init-failed");
          return;
        }

        const data = await response.json();
        window.location.href = data.authorizeUrl;
      }
      catch {
        setStatus("error");
        router.push("/?error=init-failed");
      }
    }

    initOAuth();
  }, [router]);

  const error = router.query.error;
  const errorMessage = error
    ? matchOrDefault(error as string, {
        "invalid-method": "Invalid request method",
        "oauth-access_denied": "Access denied by Hackatime",
        "oauth-error": "OAuth error occurred",
        "oauth-state-mismatch": "Security validation failed - please try again",
        "missing-code": "Missing authorization code",
        "missing-state": "Missing security token",
        "config-error": "Server configuration error",
        "init-failed": "Failed to initialize authentication",
        "invalid-token-response": "Invalid response from Hackatime",
        "token-exchange-failed": "Failed to exchange code for token",
        "invalid-user-response": "Invalid user response from Hackatime",
        "server-error": "Server error occurred"
      }) ?? (error as string)
    : null;

  return (
    <RootLayout showHeader={true}>
      <div className="flex w-full h-full items-center justify-center">
        <div className="text-center">
          {status === "loading" && (
            <p className="text-smoke">Redirecting to Hackatime for authentication...</p>
          )}
          {errorMessage && <p className="text-red-500 mt-4">{errorMessage}</p>}
        </div>
      </div>
    </RootLayout>
  );
}
