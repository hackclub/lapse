interface LoginViewProps {
  isLoggingIn: boolean;
  error: string | null;
  onLogin: () => void;
}

export function LoginView({ isLoggingIn, error, onLogin }: LoginViewProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 animate-in">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">Lapse</h1>
        <p className="text-muted text-sm">
          Record and share timelapses of your work
        </p>
      </div>

      {isLoggingIn ? (
        <div className="text-center">
          <div className="text-smoke text-sm">
            Waiting for authentication...
          </div>
          <div className="text-muted text-xs mt-2">
            Complete sign-in in your browser
          </div>
        </div>
      ) : (
        <button
          onClick={onLogin}
          className="px-6 py-2.5 bg-red text-white font-medium rounded-lg hover:brightness-110 transition-all"
        >
          Sign in with Hackatime
        </button>
      )}

      {error && <div className="text-red text-sm">{error}</div>}
    </div>
  );
}
