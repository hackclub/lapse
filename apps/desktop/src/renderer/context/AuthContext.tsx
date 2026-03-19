import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { lapse } from "../lib/desktop";
import type { IpcChannelMap } from "@/shared/ipc-channels";

type User = NonNullable<IpcChannelMap["auth:get-user"]["result"]>;

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    lapse
      .invoke("auth:get-user")
      .then(u => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async () => {
    setIsLoading(true);
    try {
      const { success } = await lapse.invoke("auth:login");
      if (success) {
        const u = await lapse.invoke("auth:get-user");
        setUser(u);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await lapse.invoke("auth:logout");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
