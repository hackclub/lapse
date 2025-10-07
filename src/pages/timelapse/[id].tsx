
import { trpc } from "@/client/trpc";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

import type { Timelapse } from "@/server/routers/api/timelapse";
import { useAsyncEffect } from "@/client/hooks/useAsyncEffect";
import { assert } from "@/shared/common";
import { deviceStorage } from "@/client/deviceStorage";
import { decryptVideoWithTimelapseId } from "@/client/encryption";

export default function Page() {
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [fetchStarted, setFetchStarted] = useState(false);
  const [timelapse, setTimelapse] = useState<Timelapse | null>(null);
  const [videoObjUrl, setVideoObjUrl] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);

  useAsyncEffect(async () => {
    if (!router.isReady || fetchStarted)
      return;

    const { id } = router.query;

    if (typeof id !== "string") {
      // TODO: display error here!
      console.error("Invalid 'id' parameter:", id);
      throw new Error("'id' should be a string.");
    }

    setFetchStarted(true);

    console.log("Querying timelapse...");
    const res = await trpc.timelapse.query.query({ id });
    if (!res.ok) {
      console.error("Couldn't fetch that timelapse!", res);

      // TODO: error modal
      setIsLoading(false);
      throw new Error(res.error);
    }

    const timelapse = res.data.timelapse;

    console.log("Timelapse fetched!", timelapse);
    setTimelapse(timelapse);
    setIsLoading(false);

    const video = videoRef.current;
    assert(video != null, "<video> element ref should've been loaded by now");

    if (timelapse.isPublished) {
      // Video is decrypted - we don't have to decrypt it client-side!
      video.src = timelapse.playbackUrl;
    }
    else {
      // This case is trickier - we have to decrypt the video client-side with the device passkey.
      const devices = await deviceStorage.getAllDevices();
      const originDevice = devices.find(x => x.id == timelapse.deviceId);

      if (!originDevice) {
        // TODO: Show a modal to input the passkey for that device
        throw new Error(`Missing passkey for device ${timelapse.deviceId}`);
      }

      const vidRes = await fetch(timelapse.playbackUrl, { method: "GET" });
      const vidData = await vidRes.arrayBuffer();
      
      // Decrypt the video data using the device passkey and timelapse ID
      const decryptedData = await decryptVideoWithTimelapseId(
        vidData,
        timelapse.id,
        originDevice.passkey
      );
      
      // Create a blob from the decrypted data and assign it to the video element
      const videoBlob = new Blob([decryptedData], { type: "video/mp4" });
      const url = URL.createObjectURL(videoBlob);
      setVideoObjUrl(url);
      video.src = url;
    }
  }, [router, router.isReady]);

  // Cleanup the video URL when component unmounts or videoUrl changes
  useEffect(() => {
    return () => {
      if (videoObjUrl) {
        URL.revokeObjectURL(videoObjUrl);
      }
    };
  }, [videoObjUrl]);

  return (
    <div
      className=""
    >
      <h1>{timelapse?.mutable.name}</h1>
      <p>{timelapse?.mutable.description}</p>

      <video ref={videoRef} controls />
    </div>
  );
}