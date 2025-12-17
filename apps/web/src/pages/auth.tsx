import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Icon from "@hackclub/icons";
import clsx from "clsx";

import { assert, matchOrDefault } from "@/shared/common";

import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";
import { ErrorModal } from "@/client/components/ui/ErrorModal";

export default function Auth() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (router.query.error) {
      assert(typeof router.query.error === "string", "queryError wasn't a string");

      setError(
        matchOrDefault(router.query.error, {
          "invalid-method": "Invalid request method",
          "oauth-access_denied": "Access denied by Slack",
          "oauth-error": "OAuth error occurred",
          "missing-code": "Missing authorization code",
          "config-error": "Server configuration error",
          "invalid-token-response": "Invalid response from Slack",
          "token-exchange-failed": "Failed to exchange code for token",
          "invalid-user-response": "Invalid user response from Slack",
          "profile-fetch-failed": "Failed to fetch user profile",
          "server-error": "Server error occurred"
        }) ?? router.query.error
      );
    }

    if (router.query.auth === "success") {
      router.push("/");
    }
  }, [router.query, router]);

  function handleSlackSignIn() {
    const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID;

    if (!clientId) {
      setError("Slack client ID not configured");
      return;
    }

    setError(null);

    const redirectUri = `${window.location.origin}/api/authSlack`;
    const slackAuthUrl = new URL("https://slack.com/oauth/v2/authorize");

    slackAuthUrl.searchParams.set("client_id", clientId);
    slackAuthUrl.searchParams.set("user_scope", "identity.basic,identity.email,identity.team,identity.avatar");
    slackAuthUrl.searchParams.set("redirect_uri", redirectUri);

    window.location.href = slackAuthUrl.toString();
  };

  return (
    <RootLayout showHeader={true}>
      <div className="flex w-full h-full sm:py-8 items-center justify-center">
        <div className={clsx(
          "p-12 -mt-32", // mobile
          "sm:h-auto sm:border sm:p-16 sm:mt-0", // desktop
          "max-w-lg w-full flex items-center sm:border-black rounded-lg", // all
        )}>
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <h1 className="text-3xl flex gap-2 font-bold text-smoke leading-tight">
                <Icon glyph="private" />
                Pick a provider
              </h1>
              <p className="text-smoke">
                {`
                  If you have signed in before, you'll be logged in. A new account will
                  be created for each service.
                `}
              </p>
            </div>

            <Button 
              className="gap-3 w-full" 
              onClick={handleSlackSignIn}
              kind="primary"
            >
              <Icon glyph="slack-fill" />
              Sign in with Slack
            </Button>
          </div>
        </div>
      </div>

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
      />
    </RootLayout>
  );
}
