import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";
import { ErrorModal } from "@/client/components/ui/ErrorModal";
import { LoadingModal } from "@/client/components/ui/LoadingModal";
import Icon from "@hackclub/icons";

export default function Auth() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { error: queryError, auth } = router.query;

    if (queryError) {
      switch (queryError) {
        case "invalid-method":
          setError("Invalid request method");
          break;
        case "oauth-access_denied":
          setError("Access denied by Slack");
          break;
        case "oauth-error":
          setError("OAuth error occurred");
          break;
        case "missing-code":
          setError("Missing authorization code");
          break;
        case "config-error":
          setError("Server configuration error");
          break;
        case "invalid-token-response":
          setError("Invalid response from Slack");
          break;
        case "token-exchange-failed":
          setError("Failed to exchange code for token");
          break;
        case "invalid-user-response":
          setError("Invalid user response from Slack");
          break;
        case "profile-fetch-failed":
          setError("Failed to fetch user profile");
          break;
        case "server-error":
          setError("Server error occurred");
          break;
        default:
          setError("An unknown error occurred");
      }
    }

    if (auth === "success") {
      router.push("/");
    }
  }, [router.query, router]);

  const handleSlackSignIn = () => {
    const clientId = process.env.NEXT_PUBLIC_SLACK_CLIENT_ID;

    if (!clientId) {
      setError("Slack client ID not configured");
      return;
    }

    setIsLoading(true);
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
      <div className="flex w-full h-full py-8 items-center justify-center">
        <div className="max-w-lg w-full bg-darkless p-16 rounded-lg">
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
              disabled={isLoading}
              kind="primary"
            >
              <Icon glyph="slack-fill" />
              {isLoading ? "Redirecting..." : "Sign in with Slack"}
            </Button>
          </div>
        </div>
      </div>

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
      />

      <LoadingModal
        isOpen={isLoading}
        title="Signing In"
        message="Redirecting to Slack for authentication..."
      />
    </RootLayout>
  );
}
