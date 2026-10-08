import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";

export const LINK_STATUS_SESSION_KEY = "lapse:hackatimeLinkStatus";

/**
 * - `linked`: everything works.
 * - `needsRelink`: the user has to authorize Lapse with Hackatime again.
 * - `restricted`: the user is banned on Hackatime, which won't let us sync anything for them. Signing in again won't help.
 */
export type HackatimeLinkStatus = "linked" | "needsRelink" | "restricted";

/**
 * The state of the signed-in user's Hackatime authorization. Anything but `needsRelink` is cached for the browser
 * session, since checking costs a request to Hackatime and almost nobody needs to be asked twice.
 */
export function useHackatimeLinkStatus(): HackatimeLinkStatus {
  const router = useRouter();
  const auth = useAuth(false);
  const [status, setStatus] = useState<HackatimeLinkStatus>("linked");

  // Nothing renders this on /auth anyway, and checking there would ask about the token being replaced.
  const isReauthenticating = router.pathname === "/auth";

  useEffect(() => {
    if (!auth.currentUser || isReauthenticating) {
      setStatus("linked");
      return;
    }

    // Someone told to reconnect is expected to go and do it, so a cached `needsRelink` would outlive the fix and
    // keep nagging them - which is exactly what it did.
    const cached = sessionStorage.getItem(LINK_STATUS_SESSION_KEY);
    if (cached === "linked" || cached === "restricted") {
      setStatus(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      const res = await api.hackatime.linkStatus({});
      if (cancelled || !res.ok)
        return;

      const next: HackatimeLinkStatus =
        res.data.restricted ? "restricted" :
        res.data.needsRelink ? "needsRelink" :
        "linked";

      if (next === "needsRelink")
        sessionStorage.removeItem(LINK_STATUS_SESSION_KEY);
      else
        sessionStorage.setItem(LINK_STATUS_SESSION_KEY, next);

      setStatus(next);
    })();

    return () => { cancelled = true; };
  }, [auth.currentUser, isReauthenticating]);

  return status;
}

/** Whether the signed-in user has to authorize Lapse with Hackatime again. */
export function useHackatimeRelink(): boolean {
  return useHackatimeLinkStatus() === "needsRelink";
}
