
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
import { PasskeyModal } from "@/client/components/ui/PasskeyModal";
import Icon from "@hackclub/icons";
import { Skeleton } from "@/client/components/ui/Skeleton";
import { Badge } from "@/client/components/ui/Badge";
import clsx from "clsx";

export default function Page() {
  const router = useRouter();
  const { currentUser } = useAuth(false);

  const [fetchStarted, setFetchStarted] = useState(false);
  const [timelapse, setTimelapse] = useState<Timelapse | null>(null);
  const [videoObjUrl, setVideoObjUrl] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorIsCritical, setErrorIsCritical] = useState(false);
  
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  
  const [passkeyModalOpen, setPasskeyModalOpen] = useState(false);
  const [missingDeviceName, setMissingDeviceName] = useState<string>("");
  const [invalidPasskeyAttempt, setInvalidPasskeyAttempt] = useState(false);
  
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [hackatimeProject, setHackatimeProject] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);

  useAsyncEffect(async () => {
    if (!router.isReady || fetchStarted)
      return;

    try {
      const { id } = router.query;

      if (typeof id !== "string") {
        setError("Invalid timelapse ID provided");
        setErrorIsCritical(true);
        return;
      }

      setFetchStarted(true);

      console.log("(timelapse/[id]) querying timelapse...");
      const res = await trpc.timelapse.query.query({ id });
      if (!res.ok) {
        console.error("(timelapse/[id]) couldn't fetch that timelapse!", res);
        setError(res.message);
        setErrorIsCritical(true);
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
        assert(timelapse.private != undefined, "Non-published timelapse that we have access to should always have private fields");
        assert(timelapse.private.device != null, "Non-published timelapse should always have a device");

        // go home typescript, you're drunk... 
        const originDevice = devices.find(x => x.id == timelapse.private!.device!.id);

        if (!originDevice) {
          setMissingDeviceName(timelapse.private.device.name);
          setInvalidPasskeyAttempt(false);
          setPasskeyModalOpen(true);
          return;
        }

        const vidRes = await fetch(timelapse.playbackUrl, { method: "GET" });
        const vidData = await vidRes.arrayBuffer();
        
        try {
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
        catch (decryptionError) {
          console.warn("(timelapse/[id]) decryption failed:", decryptionError);
          setMissingDeviceName(timelapse.private.device.name);
          setInvalidPasskeyAttempt(true);
          setPasskeyModalOpen(true);
          return;
        }
      }
    }
    catch (err) {
      console.error("(timelapse/[id]) error loading timelapse:", err);
      setErrorIsCritical(true);
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

      assert(timelapse.private != undefined, "Non-published timelapse that we have access to should always have private fields");
      assert(timelapse.private.device != null, "Non-published timelapse should always have a device");

      const devices = await deviceStorage.getAllDevices();
      const originDevice = devices.find(x => x.id === timelapse.private!.device!.id);

      if (!originDevice) {
        setErrorIsCritical(false);
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
        setErrorIsCritical(false);
        setError(`Failed to publish: ${result.error}`);
      }
    } 
    catch (error) {
      console.error("(timelapse/[id]) error publishing timelapse:", error);
      setErrorIsCritical(false);
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

  const canSyncWithHackatime = timelapse && currentUser &&
    currentUser.id === timelapse.owner.id &&
    timelapse.isPublished &&
    !timelapse.private?.hackatimeProject;

  const handleEdit = () => {
    if (!timelapse)
      return;

    setEditName(timelapse.name);
    setEditDescription(timelapse.description);
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
        setErrorIsCritical(false);
        setError(`Failed to update: ${result.error}`);
      }
    } 
    catch (error) {
      console.error("(timelapse/[id]) error updating timelapse:", error);
      setErrorIsCritical(false);
      setError(error instanceof Error ? error.message : "An error occurred while updating the timelapse.");
    } 
    finally {
      setIsUpdating(false);
    }
  };

  const isUpdateDisabled = !editName.trim() || isUpdating;

  const handleSyncWithHackatime = async () => {
    if (!timelapse || !currentUser)
      return;

    if (!currentUser.private?.hackatimeApiKey) {
      setErrorIsCritical(false);
      setError("You need to set a Hackatime API key in Settings before syncing with Hackatime.");
      return;
    }

    setHackatimeProject("");
    setSyncModalOpen(true);
  };

  const handleConfirmSync = async () => {
    if (!timelapse || !hackatimeProject.trim()) return;

    try {
      setIsSyncing(true);

      const result = await trpc.timelapse.syncWithHackatime.mutate({
        id: timelapse.id,
        hackatimeProject: hackatimeProject.trim()
      });

      if (result.ok) {
        setTimelapse(result.data.timelapse);
        setSyncModalOpen(false);
        setHackatimeProject("");
      } 
      else {
        setErrorIsCritical(false);
        setError(`Failed to sync with Hackatime: ${result.error}`);
      }
    } 
    catch (error) {
      console.error("(timelapse/[id]) error syncing with Hackatime:", error);
      setErrorIsCritical(false);
      setError(error instanceof Error ? error.message : "An error occurred while syncing with Hackatime.");
    } 
    finally {
      setIsSyncing(false);
    }
  };

  const isSyncDisabled = !hackatimeProject.trim() || isSyncing;

  async function handlePasskeySubmit(passkey: string) {
    if (!timelapse?.private?.device) return;

    try {
      await deviceStorage.saveDevice({
        id: timelapse.private.device.id,
        passkey: passkey,
        thisDevice: false
      });

      // Retry loading the timelapse with the new passkey
      setFetchStarted(false);
      setInvalidPasskeyAttempt(false);
      setPasskeyModalOpen(false);
    }
    catch (error) {
      console.error("Error saving device passkey:", error);
      setErrorIsCritical(false);
      setError("Failed to save passkey. Please try again.");
    }
  }

  return (
    <RootLayout showHeader={true} title={timelapse ? `${timelapse.name} - Lapse` : "Lapse"}>
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
              <div className="flex items-center gap-3">
                <h1 className="text-4xl font-bold text-smoke leading-tight">
                  {timelapse?.name || <Skeleton className="w-full" />}
                                  
                  {timelapse && !timelapse.isPublished && (
                    <Badge variant="warning" className="ml-4">UNPUBLISHED</Badge>
                  )}
                </h1>
              </div>
              
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
                  ? timelapse?.description || "(no description)"
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
              
              {canSyncWithHackatime && (
                <Button className="gap-2 w-full" onClick={handleSyncWithHackatime} kind="secondary">
                  <Icon glyph="history" size={24} />
                  Sync with Hackatime
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

      <WindowedModal
        icon="history"
        title="Sync with Hackatime"
        description="Import your timelapse snapshots to Hackatime as heartbeats. This can only be done once per timelapse."
        isOpen={syncModalOpen}
        setIsOpen={setSyncModalOpen}
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow/10 border border-yellow/20">
            <Icon glyph="important" size={24} className="text-yellow flex-shrink-0" />
            <div>
              <p className="font-bold text-yellow">One-time sync</p>
              <p className="text-smoke">You can only sync a timelapse with Hackatime once. Make sure you choose the correct project name.</p>
            </div>
          </div>

          <TextInput
            label="Project Name"
            description="The name of the Hackatime project to sync with."
            value={hackatimeProject}
            onChange={setHackatimeProject}
            maxLength={128}
          />

          <Button onClick={handleConfirmSync} disabled={isSyncDisabled} kind="primary">
            {isSyncing ? "Syncing..." : "Sync with Hackatime"}
          </Button>
        </div>
      </WindowedModal>

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onClose={errorIsCritical ? () => router.back() : undefined}
        onRetry={
          error?.includes("Failed to load") ? () => {
            setError(null);
            setFetchStarted(false);
          } : undefined
        }
      />

      <LoadingModal
        isOpen={isPublishing}
        title="Publishing Timelapse"
        message="We're decrypting your timelapse - hold tight!"
      />

      <PasskeyModal
        isOpen={passkeyModalOpen}
        setIsOpen={setPasskeyModalOpen}
        description={`Enter the 6-digit PIN for ${missingDeviceName} to decrypt the timelapse`}
        onPasskeySubmit={handlePasskeySubmit}
      >
        {invalidPasskeyAttempt && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow/10 border border-yellow/20">
            <Icon glyph="important" size={24} className="text-yellow flex-shrink-0" />
            <div>
              <p className="font-bold text-yellow">Invalid passkey</p>
              <p className="text-smoke">The passkey you entered could not decrypt this timelapse. Please try again.</p>
            </div>
          </div>
        )}
      </PasskeyModal>
    </RootLayout>
  );
}