import { useState } from "react";
import NextLink from "next/link";
import clsx from "clsx";
import { match } from "@hackclub/lapse-shared";
import { type PublicUser } from "@hackclub/lapse-api";
import { SkeletonBox } from "skullet/react";

const failedUrls = new Set<string>();

type ProfilePictureSize = "xs" | "sm" | "md" | "lg" | "xl";

function sizeClassOf(size: ProfilePictureSize) {
  return match(size, {
    "xs": "w-6 h-6 text-xs",
    "sm": "w-8 h-8 text-xs",
    "md": "w-10 h-10 text-sm",
    "lg": "w-12 h-12 text-base",
    "xl": "w-16 h-16 text-lg"
  });
}

export function ProfilePicture({ user, size = "md", className = "" }: {
  user: PublicUser | null,
  size?: ProfilePictureSize;
  className?: string;
}) {
  const sizeClass = sizeClassOf(size);

  const cachetUrl = user?.slackId ? `https://cachet.hackclub.com/users/${user.slackId}/r` : null;
  const [, setFailureCount] = useState(0);

  if (!user)
    return <ProfilePicture.Skeleton size={size} className={className} />;

  // Cachet always redirects to the user's current Slack avatar, whereas the stored URL is only refreshed on login.
  // Each candidate is tried once; when all of them fail (e.g. a network that blocks Slack's CDN), we show the
  // user's initial instead of retrying.
  const src = [cachetUrl, user.profilePictureUrl].find(url => url && !failedUrls.has(url));

  const interactiveClass = "cursor-pointer hover:opacity-80 transition-opacity";

  return (
    <NextLink href={`/user/@${user.handle}`}>
      {
        src
          ? (
            <img
              width={32} height={32}
              src={src}
              onError={() => {
                failedUrls.add(src);
                setFailureCount(x => x + 1);
              }}
              alt=""
              className={clsx(
                "rounded-full object-cover transition-all max-w-none",
                sizeClass,
                interactiveClass,
                className
              )}
              role="button"
              tabIndex={0}
            />
          )
          : (
            <span
              aria-hidden
              className={clsx(
                "rounded-full bg-slate text-white font-bold flex items-center justify-center select-none",
                sizeClass,
                interactiveClass,
                className
              )}
            >
              {user.displayName.charAt(0).toUpperCase()}
            </span>
          )
      }
    </NextLink>
  );
}

// The avatar is sized by its classes, so the box's own default width and height are cleared to let them through.
ProfilePicture.Skeleton = function ProfilePictureSkeleton({ size = "md", className = "" }: {
  size?: ProfilePictureSize;
  className?: string;
}) {
  return (
    <SkeletonBox
      radius="50%"
      className={clsx("block shrink-0", sizeClassOf(size), className)}
      style={{ width: undefined, height: undefined }}
    />
  );
};
