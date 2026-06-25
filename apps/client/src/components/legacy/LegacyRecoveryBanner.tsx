import NextLink from "next/link";
import { useRouter } from "next/router";

import { useLegacyRecoveryCount } from "@/hooks/useLegacyRecoveryCount";

const RECOVER_ROUTE = "/timelapse/recover";

/**
 * A site-wide black-on-yellow strip nudging the user to migrate any leftover recordings from the old (pre-Lookout)
 * pipeline. Clicking it opens the recovery page, where they can publish or discard each one. Hidden when there's
 * nothing to migrate, or while already on the recovery page.
 */
export function LegacyRecoveryBanner() {
  const router = useRouter();
  const count = useLegacyRecoveryCount();

  if (count <= 0 || router.pathname === RECOVER_ROUTE)
    return null;

  return (
    <NextLink
      href={RECOVER_ROUTE}
      className="block w-full bg-yellow text-black font-bold text-center px-6 py-2 transition-[filter] hover:brightness-95"
    >
      You have {count} unmigrated timelapse{count === 1 ? "" : "s"}. Click here to publish or discard them.
    </NextLink>
  );
}
