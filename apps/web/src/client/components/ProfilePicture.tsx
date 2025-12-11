import NextLink from "next/link";
import clsx from "clsx";

import { match } from "@/shared/common";
import { Skeleton } from "@/client/components/ui/Skeleton";
import { PublicUser } from "@/client/api";

export function ProfilePicture({
  user,
  size = "md",
  className = "",
  isSkeleton
}: {
  user: PublicUser | null,
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  isSkeleton?: boolean;
}) {
  isSkeleton ??= false;

  const sizeClass = match(size, {
    "xs": "w-6 h-6 text-xs",
    "sm": "w-8 h-8 text-xs",
    "md": "w-10 h-10 text-sm",
    "lg": "w-12 h-12 text-base",
    "xl": "w-16 h-16 text-lg"
  });

  if (isSkeleton || !user) {
    return <Skeleton circular className={sizeClass} />;
  }
  
  return (
    <NextLink href={user && `/user/@${user.handle}`}>
      <img
        width={32} height={32}
        src={user.profilePictureUrl}
        alt=""
        className={clsx(
          "rounded-full object-cover transition-all",
          sizeClass,
          user && "cursor-pointer hover:opacity-80 transition-opacity",
          className
        )}
        role={user ? "button" : undefined}
        tabIndex={user ? 0 : undefined}
      />
    </NextLink>
  );
}
