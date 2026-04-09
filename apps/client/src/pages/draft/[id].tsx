import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { clsx } from "clsx";
import posthog from "posthog-js";
import { decryptData, fromHex, MIN_SESSION_SIZE_BYTES } from "@hackclub/lapse-shared";
import { DraftTimelapse, EditListEntry, TimelapseVisibility } from "@hackclub/lapse-api";

import { EditorTimeline } from "@/components/editor/EditorTimeline";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { PublishModal } from "@/components/layout/PublishModal";
import RootLayout from "@/components/layout/RootLayout";
import { PasskeyModal } from "@/components/layout/PasskeyModal";
import { HackatimeSelectModal } from "@/components/layout/HackatimeSelectModal";
import { Skeleton } from "@/components/ui/Skeleton";

import { useAsyncEffect } from "@/hooks/useAsyncEffect";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { api } from "@/api";
import { deviceStorage } from "@/deviceStorage";
import { getCurrentDevice } from "@/encryption";
import { sfetch } from "@/safety";
import { videoDuration } from "@/video";

export default function Page() {
  const router = useRouter();

  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [editList, setEditList] = useState<EditListEntry[]>([]);

  const [draft, setDraft] = useState<DraftTimelapse | null>(null);
  const [decryptedSessions, setDecryptedSessions] = useState<{ url: string, duration: number }[] | null>(null);

  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [hackatimeModalOpen, setHackatimeModalOpen] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<TimelapseVisibility | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [errorIsCritical, setErrorIsCritical] = useState(false);

  const [passkeyModalOpen, setPasskeyModalOpen] = useState(false);
  const [pendingDraftForDecrypt, setPendingDraftForDecrypt] = useState<DraftTimelapse | null>(null);

  const playback = useVideoPlayback(decryptedSessions);

  useAsyncEffect(async () => {
    if (!router.isReady)
      return;

    try {
      const { id } = router.query;

      if (typeof id !== "string") {
        setError("Invalid timelapse ID provided");
        setErrorIsCritical(true);
        return;
      }

      console.log("([id].tsx) querying draft...");
      const res = await api.draftTimelapse.query({ id });
      if (!res.ok) {
        console.error("([id].tsx) couldn't fetch that draft!", res);
        setError(res.message);
        setErrorIsCritical(true);
        return;
      }

      console.log("([id].tsx) timelapse fetched!", res.data.timelapse);

      if (res.data.timelapse.associatedTimelapseId) {
        router.replace(`/timelapse/${res.data.timelapse.associatedTimelapseId}`);
        return;
      }

      setDraft(res.data.timelapse);
      setName(res.data.timelapse.name || null);
      setDescription(res.data.timelapse.description);
      setEditList(res.data.timelapse.editList);

      const allDevices = await deviceStorage.getAllDevices();
      const device = allDevices.find(x => x.id == res.data.timelapse.deviceId);

      if (!device) {
        setPendingDraftForDecrypt(res.data.timelapse);
        setPasskeyModalOpen(true);
        return;
      }

      const sessions = (await Promise.all(
        res.data.timelapse.sessions.map(async (x) => {
          const sessionRes = await sfetch(x);
          if (!sessionRes.ok) {
            posthog.capture("draft_load_session_fail", { sessionRes, session: x });
            throw new Error(`Could not fetch timelapse session @ ${x}`);
          }

          const data = new Blob([
            await decryptData(
              fromHex(device.passkey).buffer,
              fromHex(res.data.timelapse.iv).buffer,
              await sessionRes.arrayBuffer()
            )
          ], { type: "video/webm" });

          console.log(`([id].tsx) decrypted session @ ${x}!`, data);

          if (data.size <= MIN_SESSION_SIZE_BYTES) {
            posthog.capture("draft_session_too_small", { data, x, timelapse: res.data.timelapse, size: data.size });
            console.warn(`([id].tsx) session is impossibly small (${data.size} bytes in size) - ignoring!`);
            return null;
          }

          const url = URL.createObjectURL(data);
          return { url, duration: (await videoDuration(url)) ?? 120 };
        })
      ));

      setDecryptedSessions(
        // We can return `null` for sessions we want to skip.
        sessions.filter((x): x is { url: string, duration: number } => x !== null)
      );
    }
    catch (error) {
      posthog.capture("draft_load_fail", { error, draft });
      console.error("([id].tsx) error loading timelapse:", error);
      setError(error instanceof Error ? error.message : "An unknown error occurred while loading the timelapse");
      setErrorIsCritical(true);
    }
  }, [router, router.isReady]);

  async function handlePasskeySubmit(passkey: string) {
    if (!pendingDraftForDecrypt)
      return;

    const timelapse = pendingDraftForDecrypt;

    await deviceStorage.saveDevice({
      id: timelapse.deviceId,
      passkey,
      thisDevice: false
    });

    setDraft(timelapse);
    setName(timelapse.name || null);
    setDescription(timelapse.description);
    setEditList(timelapse.editList);

    try {
      const sessions = (await Promise.all(
        timelapse.sessions.map(async (x) => {
          const sessionRes = await sfetch(x);
          if (!sessionRes.ok)
            throw new Error(`Could not fetch timelapse session @ ${x}`);

          const encryptedData = await sessionRes.arrayBuffer();
          if (encryptedData.byteLength <= 8)
            return null;

          const data = new Blob([
            await decryptData(
              fromHex(passkey).buffer,
              fromHex(timelapse.iv).buffer,
              encryptedData
            )
          ], { type: "video/webm" });

          const url = URL.createObjectURL(data);
          return { url, duration: (await videoDuration(url)) ?? 120 };
        })
      )).filter((x): x is { url: string, duration: number } => x !== null);

      setDecryptedSessions(sessions);
      setPendingDraftForDecrypt(null);
    }
    catch (error) {
      posthog.capture("draft_decrypt_fail", { error, draft, timelapse });
      console.error("([id].tsx) error decrypting with provided key:", error);
      setError("Failed to decrypt. The key may be incorrect.");
      await deviceStorage.deleteDevice(timelapse.deviceId);
    }
  }

  async function handleDeleteDraftFromModal() {
    if (!pendingDraftForDecrypt)
      return;

    const res = await api.draftTimelapse.delete({ id: pendingDraftForDecrypt.id });
    if (!res.ok) {
      setError(res.message);
      return;
    }

    setPasskeyModalOpen(false);
    router.back();
  }

  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);

  useAsyncEffect(async () => {
    const device = await getCurrentDevice();
    setThisDeviceId(device.id);
  }, []);

  const isInCutRegion = useMemo(() => {
    return editList.some(e => e.kind === "CUT" && playback.time >= e.begin && playback.time <= e.end);
  }, [editList, playback.time]);

  async function saveAndExit() {
    if (!draft)
      return;

    const res = await api.draftTimelapse.update({
      id: draft.id,
      changes: {
        name: name ?? undefined,
        description,
        editList,
      },
    });

    if (!res.ok) {
      setError(res.message);
      return;
    }

    router.push(`/user/@${draft.owner.handle}`);
  }

  async function onDeleteClick() {
    if (!draft)
      return;

    if (!window.confirm("Are you sure you want to delete this draft? This cannot be undone!"))
      return;

    const res = await api.draftTimelapse.delete({ id: draft.id });

    if (!res.ok) {
      setError(res.message);
      return;
    }

    posthog.capture("timelapse_draft_deleted", { draft_id: draft.id });

    router.push(`/user/@${draft.owner.handle}`);
  }

  async function handleVisibilitySelected(visibility: TimelapseVisibility) {
    setPublishModalOpen(false);
    setPendingVisibility(visibility);
    setHackatimeModalOpen(true);
  }

  async function publish(hackatimeProjectName: string | null) {
    setHackatimeModalOpen(false);

    if (!draft || !pendingVisibility)
      return;

    const allDevices = await deviceStorage.getAllDevices();
    const device = allDevices.find(x => x.id === draft.deviceId);

    if (!device) {
      setError("Device not registered");
      return;
    }

    const updateRes = await api.draftTimelapse.update({
      id: draft.id,
      changes: {
        name: name ?? undefined,
        description,
        editList,
      },
    });

    if (!updateRes.ok) {
      setError(updateRes.message);
      return;
    }

    const res = await api.timelapse.publish({
      id: draft.id,
      visibility: pendingVisibility,
      deviceKey: device.passkey,
      hackatimeProject: hackatimeProjectName ?? undefined,
    });

    if (!res.ok) {
      setError(res.message);
      return;
    }

    posthog.capture("timelapse_published", {
      timelapse_id: res.data.timelapse.id,
      visibility: pendingVisibility,
      has_hackatime_project: hackatimeProjectName !== null,
    });

    router.push(`/timelapse/${res.data.timelapse.id}`);
  }

  return (
    <RootLayout showHeader={true}>
      <main className="px-16 py-4 flex w-full h-full flex-col items-center justify-center gap-8 -mt-6 overflow-hidden">
        <div className="flex gap-8 w-full h-3/5">
          <video
            className={clsx(
              "w-1/2 h-full rounded-2xl object-contain bg-[#000]",
              isInCutRegion && "grayscale brightness-75"
            )}
            ref={playback.videoRef}
            onEnded={playback.handleEnded}
            onTimeUpdate={playback.handleTimeUpdate}
          />

          <div className="flex flex-col gap-2 h-full w-1/2">
            <textarea
              maxLength={60}
              className={clsx(
                "overflow-x-auto overflow-y-hidden whitespace-nowrap rounded-lg border border-black border-dashed text-white placeholder:text-secondary p-4 resize-none w-full outline-none font-bold text-4xl h-18 flex items-center",
                "transition-colors hover:border-slate focus:border-red"
              )}
              value={name ?? undefined}
              onChange={ev => setName(ev.target.value)}
              placeholder="Untitled"
            />

            <textarea
              maxLength={280}
              className={clsx(
                "rounded-lg border border-black border-dashed text-white placeholder:text-secondary p-4 resize-none w-full outline-none flex-1 min-h-0 h-full",
                "transition-colors hover:border-slate focus:border-red"
              )}
              value={description}
              onChange={ev => setDescription(ev.target.value)}
              placeholder="Add a description, if you'd like!"
            />
          </div>
        </div>

        <div className="flex w-full">
          {decryptedSessions
            ? (
              <EditorTimeline
                editList={editList} setEditList={setEditList}
                sessions={decryptedSessions}
                playback={playback}
                onSaveAndExit={saveAndExit}
                onPublish={() => setPublishModalOpen(true)}
                onDeleteDraft={onDeleteClick}
              />
            )
            : (
              <Skeleton className="w-full h-50" />
            )
          }
        </div>

      </main>

      <PublishModal
        isOpen={publishModalOpen}
        setIsOpen={setPublishModalOpen}
        onSelect={handleVisibilitySelected}
      />

      <HackatimeSelectModal
        isOpen={hackatimeModalOpen}
        setIsOpen={setHackatimeModalOpen}
        onAccept={publish}
        onError={setError}
      />

      {pendingDraftForDecrypt && thisDeviceId && (
        <PasskeyModal
          isOpen={passkeyModalOpen}
          setIsOpen={setPasskeyModalOpen}
          description="Enter the key for the device that recorded this timelapse"
          targetDeviceId={pendingDraftForDecrypt.deviceId}
          callingDeviceId={thisDeviceId}
          onPasskeySubmit={handlePasskeySubmit}
          onDelete={handleDeleteDraftFromModal}
        />
      )}

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onClose={errorIsCritical ? () => router.back() : undefined}
      />
    </RootLayout>
  );
}