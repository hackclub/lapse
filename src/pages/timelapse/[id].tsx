
import { trpc } from "@/client/trpc";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

import type { Timelapse } from "@/server/routers/api/timelapse";
import { useAsyncEffect } from "@/client/hooks/useAsyncEffect";
import { assert } from "@/shared/common";
import { deviceStorage } from "@/client/deviceStorage";
import { decryptVideo } from "@/client/encryption";
import { useAuth } from "@/client/hooks/useAuth";
import { ErrorModal } from "@/client/components/ui/ErrorModal";
import { LoadingModal } from "@/client/components/ui/LoadingModal";
import { ProfilePicture } from "@/client/components/ui/ProfilePicture";
import RootLayout from "@/client/components/RootLayout";
import { Button } from "@/client/components/ui/Button";
import { WindowedModal } from "@/client/components/ui/WindowedModal";
import { TextInput } from "@/client/components/ui/TextInput";
import { TextareaInput } from "@/client/components/ui/TextareaInput";
import Icon from "@hackclub/icons";
import { Skeleton } from "@/client/components/ui/Skeleton";
import clsx from "clsx";

export default function Page() {
  const router = useRouter();
  const { currentUser } = useAuth(false);

  const [fetchStarted, setFetchStarted] = useState(false);
  const [timelapse, setTimelapse] = useState<Timelapse | null>(null);
  const [videoObjUrl, setVideoObjUrl] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);

  useAsyncEffect(async () => {
    if (!router.isReady || fetchStarted)
      return;

    try {
      const { id } = router.query;

      if (typeof id !== "string") {
        setError("Invalid timelapse ID provided");
        return;
      }

      setFetchStarted(true);

      console.log("(timelapse/[id]) querying timelapse...");
      const res = await trpc.timelapse.query.query({ id });
      if (!res.ok) {
        console.error("(timelapse/[id]) couldn't fetch that timelapse!", res);
        setError(res.message);
        return;
      }

      const timelapse = res.data.timelapse;

      console.log("(timelapse/[id]) timelapse fetched!", timelapse);
      setTimelapse(timelapse);

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
          setError(`This timelapse was created on a different device. Device passkey for device ${timelapse.deviceId} is required to decrypt and view this video.`);
          return;
        }

        const vidRes = await fetch(timelapse.playbackUrl, { method: "GET" });
        const vidData = await vidRes.arrayBuffer();
        
        // Decrypt the video data using the device passkey and timelapse ID
        const decryptedData = await decryptVideo(
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
    }
    catch (err) {
      console.error("(timelapse/[id]) error loading timelapse:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred while loading the timelapse");
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

  const handlePublish = async () => {
    if (!timelapse || !currentUser) return;

    try {
      setIsPublishing(true);

      const devices = await deviceStorage.getAllDevices();
      const originDevice = devices.find(x => x.id === timelapse.deviceId);

      if (!originDevice) {
        setError("Device passkey not found. Cannot publish this timelapse.");
        return;
      }

      const result = await trpc.timelapse.publish.mutate({
        id: timelapse.id,
        passkey: originDevice.passkey
      });

      if (result.ok) {
        setTimelapse(result.data.timelapse);
      } 
      else {
        setError(`Failed to publish: ${result.error}`);
      }
    } 
    catch (error) {
      console.error("(timelapse/[id]) error publishing timelapse:", error);
      setError(error instanceof Error ? error.message : "An error occurred while publishing the timelapse.");
    } 
    finally {
      setIsPublishing(false);
    }
  };

  const canPublish = timelapse && currentUser && 
    currentUser.id === timelapse.owner.id && 
    !timelapse.isPublished;

  const canEdit = timelapse && currentUser && 
    currentUser.id === timelapse.owner.id &&
    !timelapse.isPublished;

  const handleEdit = () => {
    if (!timelapse)
      return;

    setEditName(timelapse.mutable.name);
    setEditDescription(timelapse.mutable.description);
    setEditModalOpen(true);
  };

  const handleUpdate = async () => {
    if (!timelapse) return;

    try {
      setIsUpdating(true);

      const result = await trpc.timelapse.update.mutate({
        id: timelapse.id,
        changes: {
          name: editName.trim(),
          description: editDescription.trim()
        }
      });

      if (result.ok) {
        setTimelapse(result.data.timelapse);
        setEditModalOpen(false);
      } 
      else {
        setError(`Failed to update: ${result.error}`);
      }
    } 
    catch (error) {
      console.error("(timelapse/[id]) error updating timelapse:", error);
      setError(error instanceof Error ? error.message : "An error occurred while updating the timelapse.");
    } 
    finally {
      setIsUpdating(false);
    }
  };

  const isUpdateDisabled = !editName.trim() || isUpdating;

  return (
    <RootLayout showHeader={true}>
      <div className="flex w-full h-full py-8 gap-6">
        {/* Video Section */}
        <video 
          ref={videoRef} 
          controls
          width={timelapse ? undefined : 850}
          height={timelapse ? undefined : 638}
          className={clsx(
            "h-full object-contain rounded-2xl",
            !timelapse && "w-full"
          )}
        />

        {/* Content Section */}
        <div className="p-6 w-full pl-3">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-4xl font-bold text-smoke leading-tight">
                {timelapse?.mutable.name || <Skeleton className="w-full" />}
              </h1>
              
              <div className="flex items-center gap-3 mb-4">
                <ProfilePicture 
                  isSkeleton={timelapse == null}
                  profilePictureUrl={timelapse?.owner.profilePictureUrl}
                  displayName={timelapse?.owner.displayName ?? "?"}
                  size="sm"
                />

                <span className="text-smoke">
                  by {
                    timelapse == null
                    ? <Skeleton className="w-full" />
                    : <span className="text-cyan underline">{timelapse.owner.displayName}</span>
                  }
                </span>
              </div>

              <p className="text-smoke text-lg leading-relaxed">
                {
                  timelapse != null
                  ? timelapse?.mutable.description || "(no description)"
                  : <Skeleton className="w-full" lines={3} />
                }
              </p>
            </div>

            <div className="flex gap-3 w-full">
              {canEdit && (
                <Button className="gap-2 w-full" onClick={handleEdit} kind="secondary">
                  <Icon glyph="edit" size={24} />
                  Edit
                </Button>
              )}
              
              {canPublish && (
                <Button className="gap-2 w-full" onClick={handlePublish} disabled={isPublishing}>
                  <Icon glyph="send-fill" size={24} />
                  {isPublishing ? "Publishing..." : "Publish"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <WindowedModal
        icon="edit"
        title="Edit timelapse"
        description="Update your timelapse name and description."
        isOpen={editModalOpen}
        setIsOpen={setEditModalOpen}
      >
        <div className="flex flex-col gap-6">
          <TextInput
            label="Name"
            description="The title of your timelapse."
            value={editName}
            onChange={setEditName}
            maxLength={60}
          />

          <TextareaInput
            label="Description"
            description="Displayed under your timelapse. Optional."
            value={editDescription}
            onChange={setEditDescription}
            maxLength={280}
          />

          <Button onClick={handleUpdate} disabled={isUpdateDisabled} kind="primary">
            {isUpdating ? "Updating..." : "Update"}
          </Button>
        </div>
      </WindowedModal>

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onRetry={error?.includes("Failed to load") ? () => {
          setError(null);
          setFetchStarted(false);
        } : undefined}
      />

      <LoadingModal
        isOpen={isPublishing}
        title="Publishing Timelapse"
        message="Please wait while your timelapse is being published..."
      />
    </RootLayout>
  );
}