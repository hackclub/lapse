import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";

export const RELINK_SESSION_KEY = "lapse:hackatimeNeedsRelink";

/**
 * Whether the signed-in user has to authorize Lapse with Hackatime again. The answer only changes when they sign
 * in, and checking costs a request to Hackatime, so it is cached for the browser session.
 */
export function useHackatimeRelink(): boolean {
  const router = useRouter();
  const auth = useAuth(false);
  const [needsRelink, setNeedsRelink] = useState(false);

  // Nothing renders this on /auth anyway, and checking there would ask about the token being replaced.
  const isReauthenticating = router.pathname === "/auth";

  useEffect(() => {
    if (!auth.currentUser || isReauthenticating) {
      setNeedsRelink(false);
      return;
    }

    const cached = sessionStorage.getItem(RELINK_SESSION_KEY);
    if (cached !== null) {
      setNeedsRelink(cached === "true");
      return;
    }

    let cancelled = false;
    (async () => {
      const res = await api.hackatime.linkStatus({});
      if (cancelled || !res.ok)
        return;

      sessionStorage.setItem(RELINK_SESSION_KEY, String(res.data.needsRelink));
      setNeedsRelink(res.data.needsRelink);
    })();

    return () => { cancelled = true; };
  }, [auth.currentUser, isReauthenticating]);

  return needsRelink;
}
