import Icon from "@hackclub/icons";

import { api } from "@/api";
import { EditorTimeline } from "@/components/editor/EditorTimeline";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { PublishModal } from "@/components/layout/PublishModal";
import { WindowedModal } from "@/components/layout/WindowedModal";
import RootLayout from "@/components/layout/RootLayout";
import { DropdownInput } from "@/components/ui/DropdownInput";
import { Button } from "@/components/ui/Button";
import { deviceStorage } from "@/deviceStorage";
import { decryptData } from "@/encryption";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { sfetch } from "@/safety";
import { videoDuration, waitForVideoEvent } from "@/video";
import { DraftTimelapse, EditListEntry, HackatimeProject, TimelapseVisibility } from "@hackclub/lapse-api";
import { formatDuration } from "@hackclub/lapse-shared";
import { clsx } from "clsx";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";

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
  const [hackatimeProject, setHackatimeProject] = useState("");
  const [hackatimeProjects, setHackatimeProjects] = useState<HackatimeProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [errorIsCritical, setErrorIsCritical] = useState(false);

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
      setDraft(res.data.timelapse);
      setName(res.data.timelapse.name || null);
      setDescription(res.data.timelapse.description);
      setEditList(res.data.timelapse.editList);

      const allDevices = await deviceStorage.getAllDevices();
      const device = allDevices.find(x => x.id == res.data.timelapse.deviceId);

      if (!device) {
        // TODO: Open passkey modal
        throw new Error("Device not registered");
      }

      const sessions = await Promise.all(
        res.data.timelapse.sessions.map(async (x) => {
          const res = await sfetch(x);
          if (!res.ok)
            throw new Error(`Could not fetch timelapse session @ ${x}`);

          const data = new Blob([await decryptData(await res.arrayBuffer(), "", device.passkey)], { type: "video/webm" });
          console.log(`([id].tsx) decrypted session @ ${x}!`, data);

          const url = URL.createObjectURL(data);
          return { url, duration: (await videoDuration(url)) ?? 120 };
        })
      );

      setDecryptedSessions(sessions);
    }
    catch (apiErr) {
      console.error("([id].tsx) error loading timelapse:", apiErr);
      setError(apiErr instanceof Error ? apiErr.message : "An unknown error occurred while loading the timelapse");
      setErrorIsCritical(true);
    }
  }, [router, router.isReady]);

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

    router.push(`/user/@${draft.owner.handle}`);
  }

  async function handleVisibilitySelected(visibility: TimelapseVisibility) {
    setPublishModalOpen(false);
    setPendingVisibility(visibility);
    setHackatimeProject("");
    setHackatimeModalOpen(true);
    setIsLoadingProjects(true);

    try {
      const res = await api.hackatime.allProjects({});
      setHackatimeProjects(res.ok ? res.data.projects : []);
    }
    catch {
      setHackatimeProjects([]);
    }
    finally {
      setIsLoadingProjects(false);
    }
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
      passkey: device.passkey,
      hackatimeProject: hackatimeProjectName ?? undefined,
    });

    if (!res.ok) {
      setError(res.message);
      return;
    }

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

      <WindowedModal
        icon="history"
        title="Sync with Hackatime"
        description="Import your timelapse snapshots to Hackatime as heartbeats. This can only be done once per timelapse."
        isOpen={hackatimeModalOpen}
        setIsOpen={setHackatimeModalOpen}
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow/10 border border-yellow/20">
            <Icon glyph="important" size={24} className="text-yellow shrink-0" />
            <div>
              <p className="font-bold text-yellow">One-time sync</p>
              <p className="text-smoke">You can only sync a timelapse with Hackatime once. Make sure you choose the correct project name.</p>
            </div>
          </div>

          {isLoadingProjects ? (
            <div className="text-secondary text-center">Loading projects...</div>
          ) : hackatimeModalOpen && (
            <>
              <DropdownInput
                label="Project Name"
                description="Select an existing Hackatime project or type to create a new one."
                value={hackatimeProject}
                onChange={setHackatimeProject}
                options={hackatimeProjects.map(project => ({
                  value: project.name,
                  searchLabel: project.name,
                  label: (
                    <div className="flex justify-between w-full">
                      <span>{project.name}</span>
                      <span className="text-secondary">{formatDuration(project.totalSeconds)}</span>
                    </div>
                  )
                }))}
                allowUserCustom
              />

              <div className="flex gap-3">
                <Button onClick={() => publish(hackatimeProject.trim())} disabled={!hackatimeProject.trim()} kind="primary" className="w-full">
                  Sync with Hackatime
                </Button>

                <Button onClick={() => publish(null)} className="w-full">
                  Sync later
                </Button>
              </div>
            </>
          )}
        </div>
      </WindowedModal>

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onClose={errorIsCritical ? () => router.back() : undefined}
      />
    </RootLayout>
  );
}