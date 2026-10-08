import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { User } from "@hackclub/lapse-api";

import { api } from "@/api";
import { SESSIONS_KEY } from "@/components/lookout/sessions";
import { useOnce } from "@/hooks/useOnce";
import { useCache } from "@/hooks/useCache";

interface AuthContextValue {
  currentUser: User | null;
  isLoading: boolean;
  signOut: (options?: SignOutOptions) => Promise<void>;
  refreshUser: () => Promise<void>;
}

export interface SignOutOptions {
  /**
   * When `true`, the session is forgotten locally even if the server couldn't revoke its token. Used as an escape
   * hatch for when the API is unreachable - the token then stays valid until it expires on its own.
   */
  skipRevocation?: boolean;
}

const TOKEN_KEY = "lapse:token";

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Removes everything this browser remembers about the signed-in account. Device-level state is deliberately kept:
 * the OPFS store holds legacy encryption keys and unrecovered recordings, and wiping it could destroy data that
 * exists nowhere else.
 */
function forgetLocalSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSIONS_KEY);

  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("lapse:cache."))
      localStorage.removeItem(key);
  }

  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith("lapse:"))
      sessionStorage.removeItem(key);
  }
}

export function AuthProvider({ children }: {
  children: ReactNode;
}) {
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

  // Throws if the token couldn't be revoked, leaving the session intact - signing out locally while the token stays
  // valid would give the user a false sense of security, so that's only done when explicitly asked for.
  const signOut = useCallback(async (options?: SignOutOptions) => {
    console.log("(AuthContext.tsx) signing out...");

    if (!options?.skipRevocation) {
      const res = await api.user.signOut({});
      if (!res.ok)
        throw new Error(res.message);
    }

    forgetLocalSession();

    // A full navigation (rather than a router push) guarantees no in-memory state from the old session survives.
    window.location.replace("/");
  }, []);

  // Signing out in one tab should sign out every other tab too, instead of leaving them showing an account that's
  // no longer there. Tabs never receive their own `storage` events, so this only reacts to other tabs.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === TOKEN_KEY && e.oldValue !== null && e.newValue === null)
        window.location.replace("/");
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
