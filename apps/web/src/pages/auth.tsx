import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

import { matchOrDefault } from "@/shared/common";

import RootLayout from "@/client/components/RootLayout";
import { useAuthContext } from "@/client/context/AuthContext";

export default function Auth() {
  const router = useRouter();
  const { currentUser, isLoading } = useAuthContext();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const oauthInitiated = useRef(false);
  const [requireSlackLogin, setRequireSlackLogin] = useState<boolean>(false);

  useEffect(() => {
    const { error } = router.query;

    if (isLoading)
      return;

    if (currentUser && !currentUser.private.needsReauth) {
      router.push("/");
      return;
    }

    if (oauthInitiated.current)
      return;

    oauthInitiated.current = true;

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
      catch (err) {
        console.error("(auth.tsx) error when authenticating!", err);
        setStatus("error");
        router.push("/?error=init-failed");
      }
    }

    if (!error) {
      initOAuth();
    }
    else if (error === "no-profile-picture") {
      setRequireSlackLogin(true);
    }

  }, [router, isLoading, currentUser]);

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
      "server-error": "Server error occurred",
      "no-profile-picture": "No profile picture found in Hackatime account",
      "no-email": "No email found in your Hackatime profile",
    }) ?? (error as string)
    : null;

  return (
    <RootLayout showHeader={true}>
      <div className="flex w-full h-full items-center justify-center flex-col">
        <div className="text-center">
          {status === "loading" && !requireSlackLogin && (
            <p className="text-smoke">Redirecting to Hackatime for authentication...</p>
          )}
          {errorMessage && <p className="text-red-500 mt-4">{errorMessage}</p>}
        </div>
        {requireSlackLogin && (
          <div className="mt-6 text-center">
            <p className="mb-4">To complete your profile, please log in with Slack to your Hackatime account.</p>
            <a
              href="https://hackatime.hackclub.com/auth/slack"
              className="px-4 py-2 font-bold text-xl"
              style={{ color: "#ec3750" }}
              target="_blank"
              onClick={() => router.push("/")}
            >Go to Hackatime</a>
          </div>
        )}
      </div>
    </RootLayout>
  );
}
