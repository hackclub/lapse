import { match } from "@/shared/common";
import { Skeleton } from "./Skeleton";

export function ProfilePicture({
  profilePictureUrl,
  displayName,
  size = "md",
  className = "",
  isSkeleton
}: {
  profilePictureUrl?: string;
  displayName: string;
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

  if (isSkeleton)
    return <Skeleton className={`rounded-full ${sizeClass}`} />;
  
  if (profilePictureUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profilePictureUrl}
        alt={`${displayName}'s profile picture`}
        className={`${sizeClass} rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div className={`${sizeClass} bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center ${className}`}>
      <span className="text-white font-semibold">
        {displayName.charAt(0).toUpperCase() || "U"}
      </span>
    </div>
  );
}
