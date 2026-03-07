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

  useOnce(async () => {
    console.log("(AuthContext.tsx) authenticating...");
    const req = await api.user.myself({});

    console.log("(AuthContext.tsx) response:", req);

    if (!req.ok || req.data.user === null) {
      console.log("(AuthContext.tsx) user is not authenticated");
      setUserCache(null);
      setIsLoading(false);
      return;
    }

    console.log("(AuthContext.tsx) user is authenticated");
    setUserCache(req.data.user);
    setCurrentUser(req.data.user);
    setIsLoading(false);
  });

  const refreshUser = useCallback(async () => {
    setIsLoading(true);
    const req = await api.user.myself({});

    if (!req.ok || req.data.user === null) {
      setUserCache(null);
      setCurrentUser(null);
      setIsLoading(false);
      return;
    }

    setUserCache(req.data.user);
    setCurrentUser(req.data.user);
    setIsLoading(false);
  }, [setUserCache]);

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
