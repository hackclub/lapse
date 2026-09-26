import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/router";
import type { MaintenanceWindow } from "@hackclub/lapse-api";

import { api } from "@/api";
import { useAuthContext } from "@/context/AuthContext";
import { useInterval } from "@/hooks/useInterval";

const POLL_INTERVAL_MS = 60 * 1000;

interface MaintenanceContextValue {
  /**
   * The active maintenance window, `null` if there is none, or `undefined` if we haven't heard back yet.
   */
  maintenance: MaintenanceWindow | null | undefined;
}

const MaintenanceContext = createContext<MaintenanceContextValue | null>(null);

/**
 * Sends everyone but administrators to `/maintenance` while maintenance mode is on. The auth pages are left alone
 * so that administrators can still sign in.
 */
export function MaintenanceProvider({ children }: {
  children: ReactNode;
}) {
  const router = useRouter();
  const { currentUser, isLoading } = useAuthContext();
  const [maintenance, setMaintenance] = useState<MaintenanceWindow | null | undefined>(undefined);

  useInterval(async () => {
    try {
      const res = await api.global.maintenance({});
      if (res.ok)
        setMaintenance(res.data.maintenance);
    }
    catch (err) {
      console.error("(MaintenanceContext.tsx) failed to fetch maintenance status", err);
    }
  }, POLL_INTERVAL_MS);

  const isAdmin = currentUser !== null && currentUser.private.permissionLevel !== "USER";

  useEffect(() => {
    if (!maintenance || isLoading || isAdmin)
      return;

    if (router.pathname === "/maintenance" || router.pathname === "/auth" || router.pathname.startsWith("/oauth/"))
      return;

    router.replace("/maintenance");
  }, [maintenance, isLoading, isAdmin, router]);

  return (
    <MaintenanceContext.Provider value={{ maintenance }}>
      {children}
    </MaintenanceContext.Provider>
  );
}

export function useMaintenanceContext(): MaintenanceContextValue {
  const context = useContext(MaintenanceContext);
  if (context === null)
    throw new Error("useMaintenanceContext must be used within a MaintenanceProvider");

  return context;
}
