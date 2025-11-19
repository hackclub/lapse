import { formatTimeElapsed } from "@/shared/common"
import { ProfilePicture } from "./ProfilePicture"
import { Timelapse } from "@/client/api"

import NextLink from "next/link";
import { deviceStorage } from "@/client/deviceStorage";
import { decryptData, getCurrentDevice } from "@/client/encryption";
import { useEffect, useState } from "react";

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
      console.warn(`(thumbnail) no device found for timelapse ${timelapseId}!`);
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
    console.warn(`(thumbnail) Failed to decrypt thumbnail for timelapse ${timelapseId}:`, error);
    return null;
  }
}

export function TimelapseCard({ timelapse }: {
  timelapse: Timelapse
}) {
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
  });

  return (
    <NextLink href={`/timelapse/${timelapse.id}`}>
      <article className="flex flex-col gap-5">
        {
          isLoading
            ? <div role="img" className="bg-slate animate-pulse rounded-2xl w-80" />
            : <img src={thumb ?? "/images/no-thumbnail.png"} alt="" className="block rounded-2xl w-80 transition-all hover:brightness-75" />
        }
        
        <div className="flex gap-3 w-full justify-center">
          <ProfilePicture user={timelapse.owner} size="sm" />

          <div className="flex flex-col w-full">
            <h1 className="font-bold text-xl">{timelapse.name}</h1>
            <h2 className="text-xl text-secondary flex gap-2">
              <span>@{timelapse.owner.displayName}</span>
              <span>•</span>
              <span>{formatTimeElapsed(new Date(timelapse.createdAt))}</span>
            </h2>
          </div>
        </div>
      </article>
    </NextLink>
  )
}