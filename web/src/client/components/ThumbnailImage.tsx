/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import Icon from "@hackclub/icons";

import { decryptData, getCurrentDevice } from "@/client/encryption";
import { deviceStorage } from "@/client/deviceStorage";

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
      console.warn(`(ThumbnailImage.tsx) no device found for timelapse ${timelapseId}!`);
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
    console.warn(`(ThumbnailImage.tsx) Failed to decrypt thumbnail for timelapse ${timelapseId}:`, error);
    return null;
  }
}

export function ThumbnailImage({
  timelapseId,
  thumbnailUrl,
  isPublished,
  deviceId,
  alt,
  className,
  onError
}: {
  timelapseId: string;
  thumbnailUrl: string | null;
  isPublished: boolean;
  deviceId?: string;
  alt: string;
  className?: string;
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
}) {
  const [decryptedThumbnail, setDecryptedThumbnail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isPublished || !thumbnailUrl) {
      setDecryptedThumbnail(thumbnailUrl);
      return;
    }

    setIsLoading(true);
    decryptThumbnail(timelapseId, thumbnailUrl, deviceId)
      .then(setDecryptedThumbnail)
      .finally(() => setIsLoading(false));

    // Cleanup blob URL when component unmounts or thumbnail changes
    return () => {
      if (decryptedThumbnail?.startsWith("blob:")) {
        URL.revokeObjectURL(decryptedThumbnail);
      }
    };
  }, [timelapseId, thumbnailUrl, isPublished, deviceId, decryptedThumbnail]);

  if (isLoading) {
    return (
      <div className={`bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center ${className}`}>
        <Icon glyph="clock" size={48} className="text-white opacity-80 animate-pulse" />
      </div>
    );
  }

  if (!decryptedThumbnail) {
    return (
      <div className={`bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center ${className}`}>
        <Icon
          glyph="history"
          size={48}
          className="text-white opacity-80"
        />
      </div>
    );
  }

  return (
    <>
      <img
        src={decryptedThumbnail}
        alt={alt}
        className={className}
        onError={(e) => {
          e.currentTarget.style.display = "none";
          const fallback = e.currentTarget.nextElementSibling as HTMLElement;
          if (fallback) {
            fallback.style.display = "flex";
          }

          onError?.(e);
        }}
      />
      <div
        className={`absolute inset-0 bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center ${className}`}
        style={{ display: "none" }}
      >
        <Icon glyph="history" size={48} className="text-white opacity-80" />
      </div>
    </>
  );
}
