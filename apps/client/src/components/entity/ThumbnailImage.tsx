/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import posthog from "posthog-js";
import Icon from "@hackclub/icons";
import { decryptData, fromHex } from "@hackclub/lapse-shared";

import { getCurrentDevice } from "@/encryption";
import { deviceStorage } from "@/deviceStorage";
import { mediaFetch } from "@/safety";

const thumbnailCache = new Map<string, string>();

/**
 * Result of decrypting an encrypted thumbnail: a blob-URL on success, or `missingDevice` set when the key needed
 * to decrypt it isn't on this device (a distinct, recoverable case from a generic failure).
 */
export interface DecryptedThumbnail {
  url: string | null;
  missingDevice: boolean;
}

/**
 * Fetches and decrypts a client-encrypted thumbnail, returning a cached blob-URL. The result is memoized per
 * `(id, url)` so callers can re-mount without re-fetching/re-decrypting (and without leaking a blob-URL each time).
 * `mimeType` defaults to JPEG, but legacy recordings store WebP thumbnails.
 */
export async function decryptThumbnail(
  id: string,
  encryptedThumbnailUrl: string,
  iv: string,
  deviceId?: string,
  mimeType: string = "image/jpeg"
): Promise<DecryptedThumbnail> {
  const cacheKey = `${id}${encryptedThumbnailUrl}`;
  if (thumbnailCache.has(cacheKey))
    return { url: thumbnailCache.get(cacheKey)!, missingDevice: false };

  try {
    const device = deviceId ? await deviceStorage.getDevice(deviceId) : await getCurrentDevice();
    if (!device) {
      console.warn(`(ThumbnailImage.tsx) no device found for thumbnail ${id}!`);
      return { url: null, missingDevice: true };
    }

    const response = await mediaFetch(encryptedThumbnailUrl);
    if (!response.ok)
      throw new Error(`Failed to fetch encrypted thumbnail for ${id}: ${response.statusText}`);

    const url = URL.createObjectURL(
      new Blob([
        await decryptData(
          fromHex(device.passkey).buffer,
          fromHex(iv).buffer,
          await response.arrayBuffer()
        )
      ], { type: mimeType })
    );

    thumbnailCache.set(cacheKey, url);
    return { url, missingDevice: false };
  }
  catch (error) {
    posthog.capture("thumbnail_decrypt_fail", { error, timelapseId: id, encryptedThumbnailUrl });
    console.warn(`(ThumbnailImage.tsx) failed to decrypt thumbnail for ${id}:`, error);
    return { url: null, missingDevice: false };
  }
}

/**
 * Decrypts an encrypted thumbnail for display. Returns the blob-URL once ready, whether it's still `loading`, and
 * `missingKey` when the recording's device key isn't on this device. Memoized via `decryptThumbnail`, so it neither
 * re-fetches nor leaks a blob-URL across re-mounts.
 */
export function useDecryptedThumbnail(opts: {
  id: string;
  url: string | null | undefined;
  iv: string;
  deviceId?: string;
  mimeType?: string;
  enabled?: boolean;
}): { thumbnail: string | null; missingKey: boolean; loading: boolean } {
  const { id, url, iv, deviceId, mimeType, enabled = true } = opts;
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !url) return;

    let cancelled = false;
    setLoading(true);
    setMissingKey(false);

    decryptThumbnail(id, url, iv, deviceId, mimeType)
      .then(res => {
        if (cancelled) return;
        setThumbnail(res.url);
        setMissingKey(res.missingDevice);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id, url, iv, deviceId, mimeType, enabled]);

  return { thumbnail, missingKey, loading };
}

export function ThumbnailImage({ timelapseId, thumbnailUrl, isPublished, iv, deviceId, alt, className, onError }: {
  timelapseId: string;
  thumbnailUrl: string | null;
  isPublished: boolean;
  iv: string;
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
    decryptThumbnail(timelapseId, thumbnailUrl, iv, deviceId)
      .then(res => setDecryptedThumbnail(res.url))
      .finally(() => setIsLoading(false));

    // NB: we deliberately don't revoke the blob URL on unmount. `decryptThumbnail` memoizes it in a shared cache
    // (keyed by id+url) and hands the same URL to every consumer (incl. `useDecryptedThumbnail`), so revoking it
    // here would break the cached entry - the next mount would get a dead `blob:` URL and a broken thumbnail.
  }, [timelapseId, thumbnailUrl, isPublished, iv, deviceId]);

  if (isLoading) {
    return (
      <div className={`bg-linear-to-br from-purple-400 to-pink-400 flex items-center justify-center ${className}`}>
        <Icon glyph="clock" size={48} className="text-white opacity-80 animate-pulse" />
      </div>
    );
  }

  if (!decryptedThumbnail) {
    return (
      <div className={`bg-linear-to-br from-purple-400 to-pink-400 flex items-center justify-center ${className}`}>
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
        className={`absolute inset-0 bg-linear-to-br from-purple-400 to-pink-400 flex items-center justify-center ${className}`}
        style={{ display: "none" }}
      >
        <Icon glyph="history" size={48} className="text-white opacity-80" />
      </div>
    </>
  );
}
