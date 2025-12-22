import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import { Timelapse } from "@/client/api"
import { deviceStorage } from "@/client/deviceStorage";
import { decryptData, getCurrentDevice } from "@/client/encryption";

import { ProfilePicture } from "@/client/components/ProfilePicture"
import { Bullet } from "@/client/components/ui/Bullet";
import { TimeAgo } from "@/client/components/TimeAgo";

const thumbnailCache = new Map<string, string>();

async function decryptThumbnail(
  timelapseId: string,
  encryptedThumbnailUrl: string,
  deviceId?: string
): Promise<string | null> {
  const cacheKey = `${timelapseId}${encryptedThumbnailUrl}`;
  if (thumbnailCache.has(cacheKey))
    return thumbnailCache.get(cacheKey)!;

  try {
    let device;
    if (deviceId) {
      device = await deviceStorage.getDevice(deviceId);
    }
    else {
      device = await getCurrentDevice();
    }

    if (!device) {
      console.warn(`(TimelapseCard.tsx) no device found for timelapse ${timelapseId}!`);
      return null;
    }

    const response = await fetch(encryptedThumbnailUrl);
    if (!response.ok)
      throw new Error(`Failed to fetch encrypted thumbnail for ${timelapseId}: ${response.statusText}`);

    const url = URL.createObjectURL(
      new Blob([
        await decryptData(
          await response.arrayBuffer(),
          timelapseId,
          device.passkey
        )
      ], { type: "image/jpeg" })
    );

    thumbnailCache.set(cacheKey, url);
    return url;
  }
  catch (error) {
    console.warn(`(TimelapseCard.tsx) Failed to decrypt thumbnail for timelapse ${timelapseId}:`, error);
    return null;
  }
}

export function TimelapseCard({ timelapse }: {
  timelapse: Timelapse
}) {
  const router = useRouter();

  const [thumb, setThumb] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (timelapse.isPublished || !timelapse.thumbnailUrl) {
      setThumb(timelapse.thumbnailUrl);
      setIsLoading(false);
      return;
    }

    // If the timelapse is not published, the thumbnail is encrypted.
    (async () => {
      try {
        setThumb(
          await decryptThumbnail(timelapse.id, timelapse.thumbnailUrl!, timelapse.private?.device?.id)
        );
      }
      finally {
        setIsLoading(false);
      }
    })();

    return () => {
      if (thumb?.startsWith("blob:")) {
        URL.revokeObjectURL(thumb);
      }
    };
  }, [timelapse]);

  return (
    <article
      onClick={() => router.push(`/timelapse/${timelapse.id}`)}
      className="flex flex-col gap-4 sm:gap-5 cursor-pointer sm:max-w-80"
      role="button"
    >
      <div role="img" className="w-full aspect-video rounded-lg sm:rounded-2xl overflow-hidden">
        {
          isLoading
            ? <div className="bg-slate w-full h-full" />
            : <img src={thumb ?? "/images/no-thumbnail.png"} alt="" className="block w-full h-full transition-all hover:brightness-75 object-cover" />
        }
      </div>
      
      <div className="flex gap-2 sm:gap-3 w-full justify-center items-center sm:items-start">
        <ProfilePicture user={timelapse.owner} size="sm" className="" />

        <div className="flex flex-col w-full">
          <h1 className="font-bold text-md leading-none sm:leading-normal sm:text-xl line-clamp-1">{timelapse.name}</h1>
          <h2 className="text-md sm:text-xl text-secondary flex gap-1 sm:gap-2">
            <span className="truncate">@{timelapse.owner.displayName}</span>
            <Bullet />
            <TimeAgo date={timelapse.createdAt} className="shrink-0" />
          </h2>
        </div>
      </div>
    </article>
  )
}