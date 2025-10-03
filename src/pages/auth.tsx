import { useRouter } from "next/router";
import { useEffect, useState } from "react";

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to Lapse
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Create and share timelapses
          </p>
        </div>
        <div className="mt-8 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}
          <div>
            <button
              onClick={handleSlackSignIn}
              disabled={isLoading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-black hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Redirecting...
                </span>
              ) : (
                <span className="flex items-center">
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52-2.523A2.528 2.528 0 0 1 5.042 10.12a2.528 2.528 0 0 1 2.523 2.522 2.528 2.528 0 0 1-2.523 2.523m0 .297c1.569 0 2.84-1.271 2.84-2.82s-1.271-2.82-2.84-2.82-2.82 1.271-2.82 2.82 1.251 2.82 2.82 2.82m2.626 7.882c0-.639-.516-1.154-1.154-1.154-.639 0-1.155.516-1.155 1.154 0 .639.516 1.155 1.155 1.155.638 0 1.154-.516 1.154-1.155m3.923-8.67c-.168-.168-.442-.168-.61 0l-.188.188a.431.431 0 0 0 0 .61l.188.188c.168.168.442.168.61 0l.188-.188a.431.431 0 0 0 0-.61l-.188-.188zm1.7-2.205c-.639 0-1.155.516-1.155 1.154 0 .639.516 1.155 1.155 1.155.638 0 1.154-.516 1.154-1.155 0-.638-.516-1.154-1.154-1.154m3.64 4.21a2.528 2.528 0 0 1-2.52 2.523 2.528 2.528 0 0 1-2.524-2.523A2.528 2.528 0 0 1 16.51 10.12a2.528 2.528 0 0 1 2.521 2.522" />
                  </svg>
                  Sign in with Slack
                </span>
              )}
            </button>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">
              By signing in, you agree to our terms of service and privacy policy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
