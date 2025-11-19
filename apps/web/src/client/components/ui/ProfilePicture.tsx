import NextLink from "next/link";

import { match } from "../../../shared/common";
import { Skeleton } from "./Skeleton";
import { PublicUser } from "@/client/api";

export function ProfilePicture({
  user,
  size = "md",
  className = "",
  isSkeleton
}: {
  user: PublicUser | null,
  size?: "sm" | "md" | "lg";
  className?: string;
  isSkeleton?: boolean;
}) {
  isSkeleton ??= false;

  const sizeClass = match(size, {
    "sm": "w-8 h-8 text-xs",
    "md": "w-10 h-10 text-sm",
    "lg": "w-12 h-12 text-base"
  });

  const baseClasses = `${sizeClass} rounded-full ${className}`;
  const clickableClasses = user ? `${baseClasses} cursor-pointer hover:opacity-80 transition-opacity` : baseClasses;

  if (isSkeleton || !user) {
    return <Skeleton circular className={clickableClasses} />;
  }
  
  return (
    <NextLink href={user && `/user/@${user.handle}`}>
      <img
        width={32} height={32}
        src={user.profilePictureUrl}
        alt=""
        className={`${clickableClasses} object-cover transition-all`}
        role={user ? "button" : undefined}
        tabIndex={user ? 0 : undefined}
      />
    </NextLink>
  );
}
