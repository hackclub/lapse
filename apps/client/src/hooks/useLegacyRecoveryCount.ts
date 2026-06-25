import { useEffect, useState } from "react";

import { countRecoverableItems } from "@/legacyRecovery";
import { useAuth } from "@/hooks/useAuth";
import { useCache } from "@/hooks/useCache";

/**
 * How many legacy recordings the signed-in user still has to migrate (publish or discard). Returns 0 when there's
 * nothing to recover or nobody is signed in. The last known count is cached in `localStorage`, so the banner can
 * render instantly on navigation while a fresh count is fetched in the background.
 */
export function useLegacyRecoveryCount(): number {
  const auth = useAuth(false);
  const [cached, setCached] = useCache<number>("legacyRecoveryCount");
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!auth.currentUser) {
      setCount(0);
      return;
    }

    let cancelled = false;
    (async () => {
      const n = await countRecoverableItems(auth.currentUser!.id);
      if (cancelled)
        return;

      setCount(n);
      setCached(n);
    })();

    return () => { cancelled = true; };
  }, [auth.currentUser]);

  if (!auth.currentUser)
    return 0;

  // Fall back to the cached value until the first fresh count lands, to avoid a flash of "no banner".
  return count ?? cached ?? 0;
}
