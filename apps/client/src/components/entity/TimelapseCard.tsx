import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { DraftTimelapse, Timelapse } from "@hackclub/lapse-api"

import { deviceStorage } from "@/deviceStorage";
import { decryptData } from "@/encryption";
import { retryable } from "@/safety";

import { ProfilePicture } from "@/components/entity/ProfilePicture"
import { Bullet } from "@/components/ui/Bullet";
import { TimeAgo } from "@/components/TimeAgo";
import { Duration } from "@/components/Duration";
import clsx from "clsx";

const thumbnailCache = new Map<string, string>();

export function TimelapseCard({ timelapse }: {
  timelapse: DraftTimelapse | Timelapse
}) {
  const router = useRouter();
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (timelapse.isDraft) {
      // If this is a draft, the thumbnail is encrypted.
      retryable("fetching draft thumbnail", async () => {
        if (thumbnailCache.has(timelapse.previewThumbnail)) {
          setThumb(thumbnailCache.get(timelapse.previewThumbnail)!);
          return;
        }

        const res = await fetch(timelapse.previewThumbnail);
        if (!res.ok)
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);

        const encryptedThumb = await res.arrayBuffer();
        
        const device = await deviceStorage.getDevice(timelapse.deviceId);
        if (!device)
          throw new Error(`No device found for timelapse ${timelapse.id}`);

        const url = URL.createObjectURL(
          new Blob([await decryptData(encryptedThumb, timelapse.id, device.passkey)], { type: "image/webp" })
        );

        thumbnailCache.set(timelapse.previewThumbnail, url);
        setThumb(url);
      });

      return;
    }

    // The timelapse is public, and thus the thumbnail is NOT encrypted.
    setThumb(timelapse.thumbnailUrl);
  }, [timelapse]);

  return (
    <article
      onClick={() => router.push(`/${timelapse.isDraft ? "draft" : "timelapse"}/${timelapse.id}`)}
      role="button"
      className={clsx(
        "flex flex-col cursor-pointer sm:max-w-80",
        !timelapse.isDraft && "gap-4 sm:gap-5",
        timelapse.isDraft && "gap-3"
      )}
    >
      <div role="img" className="relative w-full aspect-video rounded-lg sm:rounded-2xl overflow-hidden">
        {
          !thumb
            ? <div className="bg-slate w-full h-full" />
            : <img src={thumb} alt="" className="block w-full h-full transition-all hover:brightness-75 object-cover" />
        }

        {!timelapse.isDraft && timelapse.duration > 0 && (
          <div className="absolute bottom-1 right-1 sm:bottom-2 sm:right-2 bg-black/80 text-white text-xs sm:text-sm px-1 sm:px-1.5 py-0.5 rounded font-medium">
            <Duration seconds={timelapse.duration} />
          </div>
        )}
      </div>
      
      <div className="flex gap-2 sm:gap-3 w-full justify-center items-center sm:items-start">
        { !timelapse.isDraft && <ProfilePicture user={timelapse.owner} size="sm" className="" /> }

        <div className="flex flex-col w-full">
          <h1 className="font-bold text-md leading-none sm:leading-normal sm:text-xl line-clamp-1">{timelapse.name ?? "(untitled)"}</h1>
          <h2 className={clsx(
            "text-md sm:text-xl text-secondary",
            !timelapse.isDraft && "flex gap-1 sm:gap-2"
          )}>
            {
              !timelapse.isDraft
                ? (
                  <>
                    <span className="truncate">@{timelapse.owner.displayName}</span>
                    <Bullet />
                    <TimeAgo date={timelapse.createdAt} className="shrink-0" />
                  </>
                ) : (
                  <>
                    Created <b><TimeAgo date={timelapse.createdAt} className="shrink-0" /></b>
                  </>
                )
            }
          </h2>
        </div>
      </div>
    </article>
  );
}