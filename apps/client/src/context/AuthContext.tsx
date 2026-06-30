import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/router";
import type { User } from "@hackclub/lapse-api";

import { api } from "@/api";
import { useOnce } from "@/hooks/useOnce";
import { useCache } from "@/hooks/useCache";

interface AuthContextValue {
  currentUser: User | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: {
  children: ReactNode;
}) {
  const router = useRouter();

  const [userCache, setUserCache] = useCache<User>("user");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Loads the current user from the API. A thrown error here MUST end with `isLoading` cleared:
  // if it stays true, every consumer is frozen on its loading screen forever (on `/auth` that's a
  // permanent "Redirecting to Hackatime for authentication..." with no redirect). `api.user.myself`
  // resolves to `{ user: null }` for a missing/invalid token, but it can still *reject* on a
  // transport-level failure (5xx, network/CORS blip, or any ORPCError surfaced as an exception). We
  // treat any such failure as "not authenticated" so the auth flow can recover by re-authenticating.
  const loadUser = useCallback(async () => {
    try {
      const req = await api.user.myself({});

      if (!req.ok || req.data.user === null) {
        setUserCache(null);
        setCurrentUser(null);
        return;
      }

      setUserCache(req.data.user);
      setCurrentUser(req.data.user);
    }
    catch (err) {
      console.error("(AuthContext.tsx) failed to load the current user; treating as unauthenticated", err);
      setUserCache(null);
      setCurrentUser(null);
    }
    finally {
      setIsLoading(false);
    }
  }, [setUserCache]);

  useOnce(() => {
    void loadUser();
  });

  const refreshUser = useCallback(async () => {
    setIsLoading(true);
    await loadUser();
  }, [loadUser]);

  const signOut = useCallback(async () => {
    console.log("(AuthContext.tsx) signing out...");

    await api.user.signOut({});
    setUserCache(null);
    setCurrentUser(null);
    router.push("/");
    router.reload();
  }, [router, setUserCache]);

  const effectiveUser = isLoading ? userCache : currentUser;

  const value: AuthContextValue = {
    currentUser: effectiveUser,
    isLoading,
    signOut,
    refreshUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null)
    throw new Error("useAuthContext must be used within an AuthProvider");

  return context;
}
