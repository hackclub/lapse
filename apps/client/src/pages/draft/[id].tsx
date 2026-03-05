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
import { decryptData, encryptData } from "@/encryption";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";
import { sfetch } from "@/safety";
import { getVideoAtSequenceTime, waitForVideoEvent } from "@/video";
import { DraftTimelapse, EditListEntry, HackatimeProject, TIMELAPSE_FACTOR, TimelapseVisibility } from "@hackclub/lapse-api";
import { formatDuration, last } from "@hackclub/lapse-shared";
import { clsx } from "clsx";
import { useRouter } from "next/router";
import { SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function Page() {
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement>(null);

  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [editList, setEditList] = useState<EditListEntry[]>([]);
  const [playing, setPlaying] = useState(false);

  const [time, setTime] = useState(0); // The current time in the resulting timelapse.
  const [timeBase, setTimeBase] = useState(0); // The timestamp at which the currently displayed session begins at.

  const [draft, setDraft] = useState<DraftTimelapse | null>(null);
  const [decryptedSessions, setDecryptedSessions] = useState<{ url: string, duration: number }[] | null>(null);
  const [sessionTotalTime, setSessionTotalTime] = useState(0);

  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [hackatimeModalOpen, setHackatimeModalOpen] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<TimelapseVisibility | null>(null);
  const [hackatimeProject, setHackatimeProject] = useState("");
  const [hackatimeProjects, setHackatimeProjects] = useState<HackatimeProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [errorIsCritical, setErrorIsCritical] = useState(false);

  const getVideoAtTime = useCallback((t: number) => {
    if (!decryptedSessions)
      throw new Error("Attempted to call getVideoAtTime without a draft being loaded.");

    return getVideoAtSequenceTime(t, decryptedSessions);
  }, [decryptedSessions]);

  const seekTo = useCallback((newTime: number) => {
    if (videoRef.current) {
      const session = getVideoAtTime(newTime);
      if (session.url != videoRef.current.src) {
        videoRef.current.src = session.url;
      }

      videoRef.current.currentTime = newTime - session.timeBase;
      setTimeBase(session.timeBase);
    }

    setTime(newTime);
  }, [getVideoAtTime, videoRef]);

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

          const video = document.createElement("video");
          const url = URL.createObjectURL(data);
          video.src = url;

          // With unfinalized data, we want to force the browser to seek the entire file.
          await waitForVideoEvent(video, "onloadeddata", () => video.load());
          await waitForVideoEvent(video, "onseeked", () => video.currentTime = Number.MAX_SAFE_INTEGER);
          await waitForVideoEvent(video, "onseeked", () => video.currentTime = 0.1);

          if (!isFinite(video.duration)) {
            console.error("([id.tsx]) video duration is not finite - despite our best efforts! we're assuming here, bad bad bad!", video);
            return { url, duration: 120 }; // this is, like, horrible. but should never happen
          }

          return { url, duration: video.duration };
        })
      );

      setDecryptedSessions(sessions);
      setSessionTotalTime(sessions.reduce((a, x) => a + x.duration, 0));
    }
    catch (apiErr) {
      console.error("([id].tsx) error loading timelapse:", apiErr);
      setError(apiErr instanceof Error ? apiErr.message : "An unknown error occurred while loading the timelapse");
      setErrorIsCritical(true);
    }
  }, [router, router.isReady]);

  // Every single time we load in a new batch of decrypted sessions, we should seek to the beginning. This will also initialize the video display.
  useEffect(() => {
    if (decryptedSessions) {
      seekTo(0);
    }
  }, [decryptedSessions, seekTo]);

  function handleDisplayEnded() {
    const nextTime = timeBase + (videoRef.current?.duration ?? 0);

    if (nextTime < sessionTotalTime) {
      const session = getVideoAtTime(nextTime);
      const video = videoRef.current!;
      video.src = session.url;
      video.currentTime = 0;
      setTimeBase(session.timeBase);
      setTime(nextTime);
      video.playbackRate = Math.min(TIMELAPSE_FACTOR, 16);
      video.play();
    }
    else {
      setTime(sessionTotalTime);
      setPlaying(false);
    }
  }

  const isInCutRegion = useMemo(() => {
    return editList.some(e => e.kind === "CUT" && time >= e.begin && time <= e.end);
  }, [editList, time]);

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
    });

    if (!res.ok) {
      setError(res.message);
      return;
    }

    const timelapseId = res.data.timelapse.id;

    if (hackatimeProjectName) {
      const syncRes = await api.timelapse.syncWithHackatime({
        id: timelapseId,
        hackatimeProject: hackatimeProjectName
      });

      if (!syncRes.ok) {
        setError(`Published, but failed to sync with Hackatime: ${syncRes.error}`);
        router.push(`/timelapse/${timelapseId}`);
        return;
      }
    }

    router.push(`/timelapse/${timelapseId}`);
  }

  function handleTimeUpdate(ev: SyntheticEvent<HTMLVideoElement>) {
    setTime(timeBase + ev.currentTarget.currentTime);
  }

  return (
    <RootLayout showHeader={false}>
      <main className="px-16 py-4 flex w-full h-full flex-col items-center justify-center gap-8">
        <div className="flex gap-8 w-full h-1/2">
          <video
            className={clsx(
              "w-1/2 h-full rounded-2xl object-contain bg-[#000]",
              isInCutRegion && "grayscale brightness-75"
            )}
            ref={videoRef}
            onEnded={handleDisplayEnded}
            onTimeUpdate={handleTimeUpdate}
          />

          <div className="flex flex-col gap-2 h-full w-1/2">
            <textarea
              maxLength={60}
              className={clsx(
                "overflow-y-hidden rounded-lg border border-black border-dashed text-white placeholder:text-secondary p-4 resize-none w-full outline-none font-bold text-4xl h-18 flex items-center",
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
          {decryptedSessions &&
            <EditorTimeline editList={editList} setEditList={setEditList} sessions={decryptedSessions} time={time} setTime={x => seekTo(x)} playing={playing} setPlaying={setPlaying} videoRef={videoRef} onSaveAndExit={saveAndExit} onPublish={() => setPublishModalOpen(true)} />
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
                <Button onClick={() => publish(null)} className="w-full">
                  Sync later
                </Button>
                <Button onClick={() => publish(hackatimeProject.trim())} disabled={!hackatimeProject.trim()} kind="primary" className="w-full">
                  Sync with Hackatime
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