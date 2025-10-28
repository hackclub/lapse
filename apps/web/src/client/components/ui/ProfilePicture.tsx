import { useRouter } from "next/router";
import { match } from "../../../shared/common";
import { Skeleton } from "./Skeleton";

export function ProfilePicture({
  profilePictureUrl,
  displayName,
  size = "md",
  className = "",
  isSkeleton,
  handle
}: {
  profilePictureUrl?: string;
  displayName: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  isSkeleton?: boolean;
  handle?: string;
}) {
  const router = useRouter();
  isSkeleton ??= false;

  const sizeClass = match(size, {
    "sm": "w-8 h-8 text-xs",
    "md": "w-10 h-10 text-sm",
    "lg": "w-12 h-12 text-base"
  });

  const handleClick = () => {
    if (handle) {
      router.push(`/user/@${handle}`);
    }
  };

  const baseClasses = `${sizeClass} rounded-full ${className}`;
  const clickableClasses = handle ? `${baseClasses} cursor-pointer hover:opacity-80 transition-opacity` : baseClasses;

  if (isSkeleton) {
    if (handle) {
      return (
        <div 
          className={clickableClasses}
          onClick={handleClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleClick();
            }
          }}
        >
          <Skeleton className="w-full h-full" />
        </div>
      );
    }
    return <Skeleton className={clickableClasses} />;
  }
  
  if (profilePictureUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profilePictureUrl}
        alt={`${displayName}'s profile picture`}
        className={`${clickableClasses} object-cover`}
        onClick={handleClick}
        role={handle ? "button" : undefined}
        tabIndex={handle ? 0 : undefined}
        onKeyDown={handle ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        } : undefined}
      />
    );
  }

  return (
    <div 
      className={`${clickableClasses} bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center`}
      onClick={handleClick}
      role={handle ? "button" : undefined}
      tabIndex={handle ? 0 : undefined}
      onKeyDown={handle ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      } : undefined}
    >
      <span className="text-white font-semibold">
        {displayName.charAt(0).toUpperCase() || "U"}
      </span>
    </div>
  );
}
