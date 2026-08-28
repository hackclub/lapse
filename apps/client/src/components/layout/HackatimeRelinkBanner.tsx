import NextLink from "next/link";
import { useRouter } from "next/router";

import { useHackatimeRelink } from "@/hooks/useHackatimeRelink";

const AUTH_ROUTE = "/auth";

/**
 * A site-wide strip for users whose Hackatime authorization predates the `read` scope. Their timelapses still sync,
 * but Hackatime won't hand over their project list, so the picker looks empty. Signing in again reissues the token.
 */
export function HackatimeRelinkBanner() {
  const router = useRouter();
  const needsRelink = useHackatimeRelink();

  if (!needsRelink || router.pathname === AUTH_ROUTE)
    return null;

  return (
    <NextLink
      href={`${AUTH_ROUTE}?force=1&redirect=${encodeURIComponent(router.asPath)}`}
      className="block w-full bg-red text-white font-bold text-center px-6 py-2 transition-[filter] hover:brightness-95"
    >
      Hackatime can&apos;t show your projects until you reconnect. Click here to sign in again.
    </NextLink>
  );
}
