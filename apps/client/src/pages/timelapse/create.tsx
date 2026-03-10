import { SetStateAction, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";
import clsx from "clsx";
import prettyBytes from "pretty-bytes";
import { assert, encryptData, match, fromHex } from "@hackclub/lapse-shared";

import { videoGenerateThumbnail } from "@/video";
import { getCurrentDevice } from "@/encryption";
import { deviceStorage } from "@/deviceStorage";
import { api, apiUpload } from "@/api";
import { TimelapseVideoSession } from "@/timelapseVideoSession";
import {  sleep, SteppedProgress } from "@/common";

import { useOnce } from "@/hooks/useOnce";
import { useAuth } from "@/hooks/useAuth";
import { useInterval } from "@/hooks/useInterval";

import RootLayout from "@/components/layout/RootLayout";
import { TimeSince } from "@/components/TimeSince";
import { Button } from "@/components/ui/Button";
import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { DropdownInput } from "@/components/ui/DropdownInput";
import { PillControlButton } from "@/components/ui/PillControlButton";

import RecordIcon from "@/assets/icons/record.svg";
import PauseIcon from "@/assets/icons/pause.svg";
import StopIcon from "@/assets/icons/stop.svg";

const MIN_TIMELAPSE_SIZE_BYTES = 1024;

type VideoSourceKind = "NONE" | "CAMERA" | "SCREEN";

function MediaSourceSelector({ description, stream, setStream, onInterrupt, videoSourceKind, setVideoSourceKind }: {
  description: React.ReactNode,
  stream: MediaStream | null,
  setStream: React.Dispatch<SetStateAction<MediaStream | null>>,
  onInterrupt: () => void,
  videoSourceKind: VideoSourceKind,
  setVideoSourceKind: (x: VideoSourceKind) => void
}) {
  const [changingSource, setChangingSource] = useState(false);

  const [screenLabel, setScreenLabel] = useState("Screen");
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");

  // Every single time the available media devices (e.g. cameras) change (e.g. plug/unplug), update our local state that takes track
  // of this. We *would* prefer to just use the browser's information outright, but we have to enumerate them, so that's not really an option.
  useOnce(() => {
    async function enumerateCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === "videoinput");
        console.log("(create.tsx) Enumerated cameras:", cameras);
        setAvailableCameras(cameras);
      }
      catch (err) {
        console.log("(create.tsx) Could not enumerate cameras:", err);
      }
    }

    enumerateCameras();

    navigator.mediaDevices.addEventListener("devicechange", enumerateCameras);
    return () => { navigator.mediaDevices.removeEventListener("devicechange", enumerateCameras); };
  });

  async function onVideoSourceChange(value: string) {
    // For SCREEN sources, we allow re-selection to pick a different screen.
    if (value === videoSourceKind && !(value === "SCREEN" && videoSourceKind === "SCREEN"))
      return; // no change

    if (changingSource) {
      console.warn("(create.tsx) attempted to change the video source while we're still processing a previous change. Ignoring.");
      return;
    }

    setChangingSource(true);

    // Browsers may choose to interrupt our streams (e.g. user clicks "Stop sharing") - we handle this case here.
    function listenOnStreamInterrupted(stream: MediaStream) {
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          console.warn("(create.tsx) camera track ended externally:", track.label);
          setStream(null);
          setVideoSourceKind("NONE");
          onInterrupt();
        });
      };
    }

    console.log("(create.tsx) video source changed to", value);

    let newStream: MediaStream | null = null;

    if (value.startsWith("CAMERA:")) {
      const cameraId = value.substring(7);

      try {
        if (cameraId && cameraId.trim().length > 0) {
          // We selected an option formatted like CAMERA:<ID>, which means that the user selected a camera before.
          newStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cameraId } },
            audio: false
          });
        }
        else {
          // No camera was selected before. The browser will ask the user for the camera to use.
          newStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });

          const deviceId = newStream.getVideoTracks()[0]?.getSettings()?.deviceId;
          if (deviceId) {
            // Nice - we know which device was actually selected.
            setSelectedCameraId(deviceId);
          }
          else {
            // Hm. The browser doesn't want to tell us which camera was actually selected - this means we can't actually update the UI to
            // display which device was selected. For better UX, we default to the first device. This way, we at least display what's currently selected...
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(device => device.kind === "videoinput" && device.deviceId);
            setAvailableCameras(cameras);

            if (cameras.length > 0) {
              newStream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: cameras[0].deviceId } },
                audio: false
              });

              setSelectedCameraId(cameras[0].deviceId);
            }
            else {
              throw new Error("No cameras available"); // This will trickle down to the catch clause below!
            }
          }
        }
      }
      catch (apiErr) {
        console.warn("(create.tsx) could not request permissions for camera stream.", apiErr);
        setChangingSource(false);
        return;
      }

      console.log("(create.tsx) stream retrieved!", newStream);
      setStream(newStream);

      setVideoSourceKind("CAMERA");
      setSelectedCameraId(cameraId);
    }
    else if (value == "SCREEN") {
      try {
        newStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });
      }
      catch (apiErr) {
        console.error("(create.tsx) could not request permissions for screen capture.", apiErr);
        setChangingSource(false);
        return;
      }

      console.log("(create.tsx) screen stream retrieved!", newStream);

      // We *may* be able to extract a nice label for the window on some user agents. If not, we'll just display "Screen".
      let screenLabel: string | null = newStream.getVideoTracks()[0].label;
      console.log(screenLabel);
      if (screenLabel.includes("://") || screenLabel.includes("window:")) {
        screenLabel = null;
      }

      setVideoSourceKind("SCREEN");
      setScreenLabel(screenLabel ? `Screen (${screenLabel})` : "Screen");
    }
    else {
      newStream = null;
      setVideoSourceKind("NONE");
    }

    if (newStream) {
      listenOnStreamInterrupted(newStream);
    }

    setStream(newStream);
    setChangingSource(false);
  }

  return (
    <>
      <DropdownInput
        label="Video source"
        description={description}
        value={videoSourceKind === "CAMERA" && selectedCameraId ? `CAMERA:${selectedCameraId}` : videoSourceKind}
        onChange={onVideoSourceChange}
        disabled={changingSource}
        options={[
          { value: "NONE", disabled: true, label: "(none)" },
          { value: "SCREEN", icon: "photo", label: screenLabel },
          ...(
            (availableCameras.filter(camera => camera.deviceId && camera.deviceId.length > 0).length > 0) // ...if any cameras are loaded, then...
            ? [
              // We got permission from the user to fetch their cameras - display them.
              {
                label: "Cameras", icon: "instagram" as const, group: availableCameras
                  .filter(camera => camera.deviceId && camera.deviceId.length > 0)
                  .map((x, i) => (
                    {
                      value: `CAMERA:${x.deviceId}`,
                      label: x.label && x.label.trim().length > 0 // if we have a label...
                        ? x.label.replace(/\([A-Fa-f0-9]+:[A-Fa-f0-9]+\)/, "").trim() // ...remove UUIDs from it and display it.
                        : `Camera ${i + 1}` // otherwise, just use the index.
                    }
                  ))
              }
            ] : [
              // In this case, we didn't get permission to enumerate the user's cameras, so we'll display a generic "Camera"
              // option, that when clicked, will prompt them for permission.
              { label: "Camera", value: "CAMERA:", icon: "instagram" as const }
            ])
        ]}
      />

      {stream && (
        <div className="flex flex-col gap-2">
          <video
            autoPlay
            muted
            className="h-auto rounded-md"
            style={{ transform: videoSourceKind === "CAMERA" ? "scaleX(-1)" : "none" }}
            ref={el => {
              if (el && el.srcObject !== stream) {
                el.srcObject = stream;
              }
            }}
          />
        </div>
      )}
    </>
  );
}

export default function Page() {
  const router = useRouter();
  useAuth(true);

  // This manages most of our video recording work. Each time we switch windows or refresh Lapse, we create a new session - this is needed,
  // as every time the resolution changes, the initial chunk also changes.
  const [videoSession, setVideoSession] = useState<TimelapseVideoSession | null>();

  // The main stream for the capture. We take this from the MediaSourceSelector.
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Setup modal state.
  // Depending on several factors, our setup modal can be in different discrete states:
  //    - INIT: initialization is required, and no existing timelapse exists; we aren't recording
  //    - INIT_CONTINUE: an existing timelapse exists; the user is currently choosing to keep an existing local timelapse
  //    - INIT_DISCARD: an existing timelapse exists; the user is currently choosing to discard the existing local timelapse and to make a new one
  //    - UPDATE: we are recording, and the user is re-configuring the timelapse (e.g. switching windows)
  const [setupState, setSetupState] = useState<"INIT" | "INIT_CONTINUE" | "INIT_DISCARD" | "UPDATE">("INIT");
  const [setupModalOpen, setSetupModalOpen] = useState(true);

  // The kind of video source our MediaSourceSelector gave us. This is used so that we know when to horizontally flip our preview.
  const [videoSourceKind, setVideoSourceKind] = useState<VideoSourceKind>("NONE");

  const [startedAt, setStartedAt] = useState(new Date());


  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isPaused, setIsPaused] = useState(false);

  const mainPreviewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isRecording = !isPaused && !setupModalOpen;

  // When recording, we emit heartbeats - these have nothing to do with Hackatime heartbeats; they are
  // only use for the public user recording count on the header.
  useInterval(async () => {
    if (isRecording) {
      await api.user.emitHeartbeat({});
    }
  }, 30 * 1000);

  useEffect(() => {
    document.title = setupModalOpen ? "Lapse"
      : isPaused ? `⏸️ PAUSED`
      : `🔴 REC`;
  }, [setupModalOpen, isPaused]);

  useOnce(async () => {
    const existing = await deviceStorage.getTimelapse();
    if (existing) {
      const size = await deviceStorage.getTimelapseVideoSize();
      if (size < MIN_TIMELAPSE_SIZE_BYTES) {
        console.log("(create.tsx) discarding tiny existing timelapse from OPFS", { size });
        await deviceStorage.deleteTimelapse();
        return;
      }

      setSetupState("INIT_CONTINUE");
    }
  });

  /**
   * Runs when the user begins recording a new session for a timelapse. This function is **NOT** invoked as soon
   * as we navigate to the page - only when the user actually selects the media source and confirms
   * their selection do we call this function.
   * 
   * This function MAY be called when the user *changes* their media source, thus creating a new session for an existing timelapse.
   * @param shouldDiscard If `true`, if a timelapse already is stored in the user's device storage, it should be discarded. This is a **destructive operation**.
   */
  async function onSessionBegin(shouldDiscard: boolean, newStream: MediaStream) {
    let existing = await deviceStorage.getTimelapse();

    if (shouldDiscard) {
      // It's a bit illogical for the following assertion to fail - discarding ONLY can happen when we open the setup modal at the beginning
      // (i.e. INIT/INIT_CONTINUE/INIT_DISCARD). This realistically only fails for UPDATE, which can't really discard.
      assert(videoSession == null, "Discarding a timelapse, but we already had a stream/video session running");

      if (existing != null) {
        if (!window.confirm("Are you sure you want to overwrite your existing timelapse? It will be lost forever! (A long time!)"))
          return;

        try {
          console.log("(create.tsx) ⚠️ discarding previous timelapse!", existing);
          await deviceStorage.deleteTimelapse();
          existing = null;
        }
        catch (err) {
          console.error("(create.tsx) failed to discard timelapse:", err);
          setError(err instanceof Error ? err.message : "Failed to discard timelapse");
        }
      }
      else {
        console.warn("(create.tsx) onSessionBegin() was called with shouldDiscard = true, but no active timelapse is present");
      }
    }

    mainPreviewRef.current!.srcObject = newStream;
    setSetupModalOpen(false); // when the session begins, the setup modal closes

    if (!existing) {
      // No timelapse has been stored before - we need to create one.
      existing = await deviceStorage.createTimelapse();
      setStartedAt(new Date());
    }
    else {
      console.log("(create.tsx) resuming existing timelapse!", existing);

      const TOLERANCE = 2 * 60 * 1000;
      let totalMs = 0;
      for (let i = 1; i < existing.snapshots.length; i++) {
        const span = existing.snapshots[i] - existing.snapshots[i - 1];
        if (span <= TOLERANCE) {
          totalMs += span;
        }
      }

      setStartedAt(new Date(Date.now() - totalMs));
    }

    // ...and we're off!
    setVideoSession(new TimelapseVideoSession(newStream));
  }

  function setPause(shouldBePaused: boolean) {
    if ( (shouldBePaused && !isPaused) || (!shouldBePaused && isPaused) ) {
      togglePause();
    }
  }

  function togglePause() {
    if (isPaused) {
      setIsPaused(false);
      videoSession?.resume();
    }
    else {
      setIsPaused(true);
      videoSession?.pause();
    }
  }

  async function uploadLocalTimelapse(options: { stopSession: boolean }) {
    if (isUploading) {
      return;
    }

    if (options.stopSession) {
      if (!videoSession) {
        console.warn("(create.tsx) attempted to stop the recording while no session has been started yet!");
        return;
      }

      await videoSession.stop();
      setVideoSession(null);
    }

    setIsUploading(true);

    function bytesProgressCallback(uploaded: number, total: number) {
      setUploadProgress((uploaded / total) * 100);
      setUploadStage(`Uploading video session... (${prettyBytes(uploaded)}/${prettyBytes(total)})`);
    }

    let progress = new SteppedProgress(6, setUploadStage, setUploadProgress);

    try {
      // ------------------------------------------------------- //
      progress.advance(0, "Loading data from disk...");

      await deviceStorage.sync(); // if we have any pending operations (e.g. writing chunks to disk), wait for them to finish

      const sessions = await deviceStorage.getTimelapseVideoSessions();
      const timelapse = await deviceStorage.getTimelapse();
      if (!timelapse || sessions.length == 0) {
        console.error("(create.tsx) No local timelapse, or no sessions have been captured! Your browser storage might be malfuctioning...?", timelapse, sessions);
        throw new Error("No local timelapse, or no sessions have been captured");
      }

      console.log("(create.tsx) recording stopped!", timelapse);

      // ------------------------------------------------------- //
      progress.advance(1, "Generating thumbnail...");
      const thumbnail = await videoGenerateThumbnail(sessions[0]);
      console.log("(create.tsx) thumbnail generated:", thumbnail);

      // ------------------------------------------------------- //
      progress.advance(2, "Talking with the server...");
      const device = await getCurrentDevice();
      const res = await api.draftTimelapse.create({
        snapshots: timelapse.snapshots,
        thumbnailSize: thumbnail.size,
        deviceId: device.id,
        sessions: sessions.map(x => ({ fileSize: x.size + 8192 })) // we add an 8KiB margin, because encryption adds some marginal overhead, and we don't want to force the user to store every session in memory
      });

      console.log("(create.tsx) draftTimelapse.create response:", res);

      if (!res.ok)
        throw new Error(res.message);
      
      // ------------------------------------------------------- //
      for (const [i, session] of sessions.entries()) {
        setUploadProgress(0);
        setUploadStage(`Encrypting session #${i + 1}...`);
        const encrypted = await encryptData(
          fromHex(device.passkey).buffer,
          fromHex(res.data.draftTimelapse.iv).buffer,
          session
        );

        console.log(`(create.tsx) encrypted session #${i + 1}:`, encrypted);

        setUploadStage("Uploading video session...");
        await apiUpload(res.data.sessionUploadTokens[i], new Blob([encrypted], { type: "video/webm" }), bytesProgressCallback);
      }

      console.log("(create.tsx) all sessions uploaded successfully!");
      // ------------------------------------------------------- //

      progress.advance(3, "Encrypting thumbnail...");
      const encryptedThumb = await encryptData(
        fromHex(device.passkey).buffer,
        fromHex(res.data.draftTimelapse.iv).buffer,
        thumbnail
      );

      console.log("(create.tsx) - encrypted thumbnail:", encryptedThumb);

      await apiUpload(
        res.data.thumbnailUploadToken,
        new Blob([encryptedThumb], { type: "image/webp" }),
        bytesProgressCallback
      );
      
      console.log("(create.tsx) thumbnail uploaded successfully! we're done, yay!");

      progress.advance(4, "Cleaning up local data...");

      await deviceStorage.deleteTimelapse();

      progress.advance(5, "Upload complete!");

      // We're done here! We can dispose of the stream.
      if (stream) {
        stream.getTracks().forEach(x => x.stop());
      }

      await sleep(100);

      // Browsers can choose to still display the sharing alert even when we disposed of all the streams. Using `location.href` instead of
      // `router.push` here is worse for performance, but should force all browsers to hide the alert.
      location.href = `/draft/${res.data.draftTimelapse.id}`;
    }
    catch (apiErr) {
      console.error("(create.tsx) upload failed:", apiErr);
      setIsUploading(false);
      setError(apiErr instanceof Error ? apiErr.message : "An unknown error occurred during upload");
    }
  }

  async function stopRecording() {
    if (!videoSession) {
      console.warn("(create.tsx) attempted to stop the recording while no session has been started yet!");
      return;
    }

    await videoSession.stop();
    setVideoSession(null);
    await deviceStorage.sync();

    const size = await deviceStorage.getTimelapseVideoSize();
    if (size < MIN_TIMELAPSE_SIZE_BYTES) {
      console.log("(create.tsx) discarding tiny timelapse after stop", { size });
      await deviceStorage.deleteTimelapse();

      if (stream) {
        stream.getTracks().forEach(x => x.stop());
      }

      location.href = "/";
      return;
    }

    await uploadLocalTimelapse({ stopSession: false });
  }

  async function submitExistingTimelapse() {
    await uploadLocalTimelapse({ stopSession: videoSession != null });
  }

  function onSetupModalClose() {
    if (setupState !== "UPDATE") {
      router.back();
    }

    setSetupModalOpen(false);
  }

  // The media stream selector detects interrupts in the streams it selects for us - we handle those events here.
  function handleStreamInterrupt() {
    
  }

  return (
    <RootLayout showHeader={false}>
      <Modal isOpen={setupModalOpen}>
        <ModalHeader
          icon={setupState == "INIT_DISCARD" ? "plus-fill" : "clock-fill"}
          showCloseButton={true}
          onClose={onSetupModalClose}
          title={match(setupState, {
            "INIT": "Create timelapse",
            "INIT_CONTINUE": "Resume timelapse",
            "INIT_DISCARD": "Overwrite timelapse",
            "UPDATE": "Update timelapse"
          })}
          description={match(setupState, {
            "INIT": "After you click Create, your timelapse will start recording!",
            "INIT_CONTINUE": "Select your video source to resume recording your timelapse.",
            "INIT_DISCARD": "After you click Create, your timelapse will start recording!",
            "UPDATE": "Update your timelapse settings."
          })}
          shortDescription={match(setupState, {
            "INIT": "Select a video source",
            "INIT_CONTINUE": "Select a video source to resume",
            "INIT_DISCARD": "Select a video source",
            "UPDATE": "Update your timelapse settings"
          })}
        />

        <ModalContent>
          <div className="overflow-x-hidden overflow-y-visible p-px -m-px">
            <div
              className={clsx(
                "flex transition-transform duration-200 ease-out",
                setupState === "INIT_DISCARD" && "-translate-x-1/2"
              )}
              style={{ width: "200%" }}
            >
              {/*
                We have two panels rendered at the same time for the nice scrolling animation when the user hits "discard". The other one is only
                of importance if setupState is INIT_CONTINUE or INIT_DISCARD.
              */}
              {[false, true].map((panelIsDiscarding) => (
                <div key={panelIsDiscarding ? "discard" : "resume"} className={clsx("w-1/2 shrink-0", panelIsDiscarding ? "pl-4" : "pr-4")}>
                  <div className="flex flex-col gap-6">
                    <MediaSourceSelector
                      stream={stream} setStream={setStream}
                      videoSourceKind={videoSourceKind} setVideoSourceKind={setVideoSourceKind}
                      onInterrupt={handleStreamInterrupt}
                      description={
                        panelIsDiscarding
                          ? <span className="text-red">This will permanently discard your previous timelapse.</span>
                          : "Record your screen, camera, or any other video source."
                      }
                    />

                    <div className="flex gap-4 w-full">
                      {panelIsDiscarding ? (
                        <>
                          <Button onClick={() => setSetupState("INIT_CONTINUE")} kind="regular" icon="view-back">Back</Button>
                          <Button onClick={() => onSessionBegin(true, stream!)} disabled={!stream} kind="primary" className="flex-1">Create</Button>
                        </>
                      ) : (
                        <>
                          <Button onClick={() => onSessionBegin(false, stream!)} disabled={!stream} kind="primary" className="flex-1">
                            {
                              setupState == "INIT_CONTINUE" ? "Resume" :
                              setupState == "UPDATE" ? "Update" :
                              "Create"
                            }
                          </Button>

                          { setupState === "INIT_CONTINUE" && (
                            <Button onClick={submitExistingTimelapse} kind="regular" icon="send-fill">
                              Submit
                            </Button>
                          ) }

                          { (setupState === "INIT_CONTINUE" || setupState === "INIT_DISCARD") && (
                            <Button onClick={() => setSetupState("INIT_DISCARD")} kind="destructive" icon="delete">
                              Discard
                            </Button>
                          ) }
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ModalContent>
      </Modal>

      <div className="flex w-screen h-screen bg-dark p-8 relative">
        {/* stats (overlay) */}
        <div className="z-10 absolute top-12 left-24 bg-dark shadow-xl text-xl font-mono font-bold px-8 py-4 flex gap-4 items-center border border-black rounded-[64px]">
          <div
            className={clsx(
              "rounded-full w-4 h-4",
              isRecording ? "bg-red animate-blink" : "bg-secondary"
            )}
          />

          <TimeSince active={isRecording} startTime={startedAt} showUnknown={stream == null || setupModalOpen} />
        </div>

        {/* controls (overlay) */}
        <div className="z-10 absolute right-12 top-1/2 -translate-y-1/2 bg-dark border border-black rounded-[48px] shadow-xl px-2.5 py-11 flex flex-col gap-8">
          <PillControlButton onClick={togglePause}>
            {isPaused ? <RecordIcon className="p-3" width={48} height={48} /> : <PauseIcon className="p-3" width={48} height={48} />}
          </PillControlButton>

          <PillControlButton onClick={() => stopRecording()}>
            <StopIcon className="p-3" width={48} height={48} />
          </PillControlButton>

          <PillControlButton onClick={() => {
            setSetupState("UPDATE");
            setSetupModalOpen(true);
          }}>
            <Icon glyph="settings" width={48} height={48} />
          </PillControlButton>
        </div>

        {/* video (main) */}
        <div className="w-full h-full flex justify-center">
          <video
            ref={mainPreviewRef}
            autoPlay
            muted
            className="h-full rounded-[48px]"
            style={{ transform: videoSourceKind === "CAMERA" ? "scaleX(-1)" : "none" }}
          />
        </div>
      </div>

      {/* This canvas isn't displayed to the user - we only use this as a buffer. */}
      <canvas ref={canvasRef} className="hidden" />

      <LoadingModal
        isOpen={isUploading}
        title="Uploading Timelapse"
        message={uploadStage}
        progress={uploadProgress}
      />

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onClose={() => router.back()}
        onRetry={() => {
          setError(null);
          stopRecording();
        }}
      />
    </RootLayout>
  );
}
