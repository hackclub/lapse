import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";

export const RELINK_SESSION_KEY = "lapse:hackatimeNeedsRelink";

/**
 * Whether the signed-in user has to authorize Lapse with Hackatime again. A "no" is cached for the browser
 * session, since checking costs a request to Hackatime and almost nobody needs to be asked twice.
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

    // Only "no" is worth remembering. Someone told to reconnect is expected to go and do it, so a cached "yes"
    // would outlive the fix and keep nagging them - which is exactly what it did.
    if (sessionStorage.getItem(RELINK_SESSION_KEY) === "false") {
      setNeedsRelink(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const res = await api.hackatime.linkStatus({});
      if (cancelled || !res.ok)
        return;

      if (res.data.needsRelink)
        sessionStorage.removeItem(RELINK_SESSION_KEY);
      else
        sessionStorage.setItem(RELINK_SESSION_KEY, "false");

      setNeedsRelink(res.data.needsRelink);
    })();

    return () => { cancelled = true; };
  }, [auth.currentUser, isReauthenticating]);

  return needsRelink;
}
