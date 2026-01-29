"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";
import clsx from "clsx";

import { TIMELAPSE_FRAME_LENGTH_MS } from "@/shared/constants";
import { assert } from "@/shared/common";

import { createMediaRecorder, mergeVideoSessions, videoGenerateThumbnail } from "@/client/videoProcessing";
import { encryptVideo, encryptData, getCurrentDevice } from "@/client/encryption";
import { deviceStorage, LocalSnapshot } from "@/client/deviceStorage";
import { apiUpload } from "@/client/upload";
import { trpc } from "@/client/trpc";

import { useOnce } from "@/client/hooks/useOnce";
import { useAuth } from "@/client/hooks/useAuth";
import { useInterval } from "@/client/hooks/useInterval";

import RootLayout from "@/client/components/RootLayout";
import { TimeSince } from "@/client/components/TimeSince";
import { Button } from "@/client/components/ui/Button";
import { Modal, ModalHeader, ModalContent } from "@/client/components/ui/Modal";
import { WindowedModal } from "@/client/components/ui/WindowedModal";
import { LoadingModal } from "@/client/components/ui/LoadingModal";
import { ErrorModal } from "@/client/components/ui/ErrorModal";
import { TextareaInput } from "@/client/components/ui/TextareaInput";
import { TextInput } from "@/client/components/ui/TextInput";
import { DropdownInput } from "@/client/components/ui/DropdownInput";
import { PillControlButton } from "@/client/components/ui/PillControlButton";

import RecordIcon from "@/client/assets/icons/record.svg";
import PauseIcon from "@/client/assets/icons/pause.svg";
import StopIcon from "@/client/assets/icons/stop.svg";

export default function Page() {
  const router = useRouter();
  useAuth(true);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [setupModalOpen, setSetupModalOpen] = useState(true);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [isCreated, setIsCreated] = useState(false);
  const [videoSourceKind, setVideoSourceKind] = useState("NONE");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [screenLabel, setScreenLabel] = useState("Screen");
  const [changingSource, setChangingSource] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [startedAt, setStartedAt] = useState(new Date());
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [frameInterval, setFrameInterval] = useState<NodeJS.Timeout | null>(null);
  const [currentTimelapseId, setCurrentTimelapseId] = useState<number | null>(null);
  const [needsVideoSource, setNeedsVideoSource] = useState(false);
  const [currentSession] = useState<number>(Date.now());
  const [initialElapsedSeconds, setInitialElapsedSeconds] = useState(0);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isFrozen, setIsFrozen] = useState(false);
  const isFrozenRef = useRef(false);


  const mainPreviewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const currentStream = cameraStream || screenStream;
  const isRecording = !isFrozen && !setupModalOpen;

  useInterval(async () => {
    if (isRecording) {
      await trpc.user.emitHeartbeat.mutate({});
    }
  }, 30 * 1000);

  useEffect(() => {
    document.title = setupModalOpen ? "Lapse"
      : isFrozen ? `⏸️ PAUSED: ${name} - Lapse`
      : `🔴 REC: ${name} - Lapse`;
  }, [name, setupModalOpen, isFrozen]);

  useEffect(() => {
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
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", enumerateCameras);
    };
  }, []);

  useOnce(async () => {
    const activeTimelapse = await deviceStorage.getActiveTimelapse();
    if (!activeTimelapse) {
      console.log("(create.tsx) no timelapse was started previously.");
      return;
    }

    console.group("(create.tsx) An incomplete timelapse has been detected!");
    console.log("(create.tsx) - timelapse:", activeTimelapse);

    const snapshots = await deviceStorage.getAllSnapshots();
    console.log("(create.tsx) - snapshots:", snapshots);
    console.groupEnd();

    let adjustedStartTime = new Date(activeTimelapse.startedAt);
    if (snapshots.length > 0) {
      const sessionGroups = new Map<number, LocalSnapshot[]>();
      for (const snapshot of snapshots) {
        if (!sessionGroups.has(snapshot.session)) {
          sessionGroups.set(snapshot.session, []);
        }

        sessionGroups.get(snapshot.session)!.push(snapshot);
      }

      console.group("(create.tsx) Sessions:");
      let totalElapsedTime = 0;
      for (const [session, sessionSnapshots] of sessionGroups) {
        if (sessionSnapshots.length > 1) {
          const sorted = sessionSnapshots.sort((a, b) => a.createdAt - b.createdAt);
          const sessionStart = sorted[0].createdAt;
          const sessionEnd = sorted[sorted.length - 1].createdAt;
          const sessionDuration = sessionEnd - sessionStart;
          totalElapsedTime += sessionDuration;

          console.log(`(create.tsx) Session ${session}: ${sessionDuration}ms (${sessionSnapshots.length} snapshots)`);
        }
      }
      console.groupEnd();

      adjustedStartTime = new Date(Date.now() - totalElapsedTime);
      setInitialElapsedSeconds(Math.floor(totalElapsedTime / 1000));

      console.log("(create.tsx) session groups:", sessionGroups);
      console.log("(create.tsx) total elapsed time:", totalElapsedTime);
    }

    setCurrentTimelapseId(activeTimelapse.id);
    setStartedAt(adjustedStartTime);
    setIsCreated(true);

    setNeedsVideoSource(true);
    setSetupModalOpen(true);
  });


  const captureFrame = useCallback(async (timelapseId?: number) => {
    if (isFrozenRef.current)
      return;

    const video = mainPreviewRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas)
      return;

    const ctx = canvas.getContext("2d");
    if (!ctx)
      return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    if (recorder && recorder.state === "recording") {
      recorder.requestData();
    }

    const activeTimelapseId = timelapseId ?? currentTimelapseId;
    if (activeTimelapseId == null)
      throw new Error("captureFrame() was called, but currentTimelapseId is null");

    deviceStorage.saveSnapshot({
      createdAt: Date.now(),
      session: currentSession
    });

  }, [recorder, currentTimelapseId, currentSession]);

  async function onCreate() {
    console.log("(create.tsx) creating a new timelapse!");

    mainPreviewRef.current!.srcObject = currentStream!;
    setSetupModalOpen(false);
    setNeedsVideoSource(false);

    let activeTimelapseId = currentTimelapseId;

    if (isDiscarding && currentTimelapseId) {
      console.log("(create.tsx) discarding previous timelapse:", currentTimelapseId);
      await deviceStorage.deleteAllSnapshots();
      await deviceStorage.deleteTimelapse(currentTimelapseId);
      setCurrentTimelapseId(null);
      activeTimelapseId = null;
      setIsDiscarding(false);
      setInitialElapsedSeconds(0);
    }

    if (!activeTimelapseId) {
      // Creating a new timelapse

      const now = new Date();
      setStartedAt(now);
      setIsCreated(true);

      const timelapseId = await deviceStorage.saveTimelapse({
        name,
        description,
        startedAt: now.getTime(),
        chunks: [],
        isActive: true,
      });

      setCurrentTimelapseId(timelapseId);
      activeTimelapseId = timelapseId;

      console.log(`(create.tsx) new local timelapse created with ID ${timelapseId}`);
    }
    else {
      if (currentTimelapseId) {
        const existingTimelapse = await deviceStorage.getTimelapse(currentTimelapseId);

        if (existingTimelapse) {
          existingTimelapse.name = name;
          existingTimelapse.description = description;
          await deviceStorage.saveTimelapse(existingTimelapse);
        }
      }
    }

    // Only set up recording if not already active (for new timelapses or resumed ones)
    if (!recorder || recorder.state === "inactive") {
      const canvas = canvasRef.current!;
      const stream = canvas.captureStream(1000 / TIMELAPSE_FRAME_LENGTH_MS);

      const newRecorder = createMediaRecorder(stream);

      newRecorder.ondataavailable = async (ev) => {
        if (ev.data.size <= 0)
          return;

        assert(activeTimelapseId != null, "activeTimelapseId was null when ondataavailable was called");
        await deviceStorage.appendChunk(
          activeTimelapseId,
          ev.data,
          currentSession
        );
      };

      console.log("(create.tsx) creating new recorder!", newRecorder);
      setRecorder(newRecorder);
      newRecorder.start(TIMELAPSE_FRAME_LENGTH_MS);

      if (frameInterval) {
        console.warn("(create.tsx) clearing previous frame capture interval.");
        clearInterval(frameInterval);
      }

      const newInterval = setInterval(
        () => captureFrame(activeTimelapseId!),
        TIMELAPSE_FRAME_LENGTH_MS
      );

      setFrameInterval(newInterval);
    }

    setFreeze(false);
  }

  async function onVideoSourceChange(ev: ChangeEvent<HTMLSelectElement>) {
    if (ev.target.value == videoSourceKind)
      return; // no change

    if (changingSource) {
      console.warn("(create.tsx) attempted to change the video source while we're still processing a previous change. Ignoring.");
      return;
    }

    setChangingSource(true);

    function disposeStreams() {
      setScreenLabel("Screen");

      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        setCameraStream(null);
      }

      if (screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
        setScreenStream(null);
      }
    }

    function addStreamStoppedAlertListener(stream: MediaStream) {
      stream.getTracks().forEach(track => {
        track.addEventListener("ended", () => {
          console.log("(create.tsx) camera track ended externally:", track.label);
          setCameraStream(null);
          setVideoSourceKind("NONE");
          setNeedsVideoSource(true);
          setSetupModalOpen(true);
          setFreeze(true);
          setTimeout(() => {
            if (window.location.href.includes("/timelapse/create")) {
              alert("Your screen sharing has ended. Please select a new video source to continue your timelapse.");
            }
          }, 5000);
        });
      });
    }

    console.log("(create.tsx) video source changed to", ev.target.value);

    if (ev.target.value.startsWith("CAMERA:")) {

      const cameraId = ev.target.value.substring(7);
      let stream: MediaStream;

      try {
        if (cameraId && cameraId.trim().length > 0) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cameraId } },
            audio: false
          });
        }
        else {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });

          stream.getTracks().forEach(track => track.stop());

          const devices = await navigator.mediaDevices.enumerateDevices();
          const cameras = devices.filter(device => device.kind === "videoinput" && device.deviceId);
          setAvailableCameras(cameras);

          if (cameras.length > 0) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: cameras[0].deviceId } },
              audio: false
            });
            setSelectedCameraId(cameras[0].deviceId);
          }
          else {
            throw new Error("No cameras available");
          }
        }
      }
      catch (apiErr) {
        console.error("(create.tsx) could not request permissions for camera stream.", apiErr);
        setChangingSource(false);
        return;
      }

      console.log("(create.tsx) stream retrieved!", stream);

      addStreamStoppedAlertListener(stream);

      disposeStreams();
      setCameraStream(stream);
      setVideoSourceKind("CAMERA");
      setSelectedCameraId(cameraId);
    }
    else if (ev.target.value == "SCREEN") {
      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
      }
      catch (apiErr) {
        console.error("(create.tsx) could not request permissions for screen capture.", apiErr);
        setChangingSource(false);
        return;
      }

      console.log("(create.tsx) screen stream retrieved!", stream);

      addStreamStoppedAlertListener(stream);

      let screenLabel: string | null = stream.getVideoTracks()[0].label;
      if (screenLabel.includes("://") || screenLabel.includes("window:")) {
        screenLabel = null;
      }

      disposeStreams();
      setScreenStream(stream);
      setVideoSourceKind("SCREEN");
      setScreenLabel(screenLabel ? `Screen (${screenLabel})` : "Screen");
    }
    else {
      setNeedsVideoSource(true);
      disposeStreams();
      setVideoSourceKind("NONE");
    }

    setChangingSource(false);
  }

  function setFreeze(shouldBeFrozen: boolean) {
    if ( (shouldBeFrozen && !isFrozen) || (!shouldBeFrozen && isFrozen) ) {
      toggleFreeze();
    }
  }

  function toggleFreeze() {
    if (isFrozen) {
      setIsFrozen(false);
      isFrozenRef.current = false;
      recorder?.resume();
    }
    else {
      setIsFrozen(true);
      isFrozenRef.current = true;
      recorder?.pause();
    }
  }

  async function stopRecording() {
    if (frameInterval) {
      clearInterval(frameInterval);
      setFrameInterval(null);
    }

    if (!recorder) {
      console.warn("(create.tsx) attempted to stop the recording while recorder was null!");
      return;
    }

    recorder.onstop = async () => {
      try {
        console.log("(upload) synchronizing deviceStorage...");
        await deviceStorage.sync();
        console.log("(upload) synchronized! proceeding!");

        setIsUploading(true);
        setUploadProgress(0);
        setUploadStage("Preparing upload...");

        assert(currentTimelapseId != null, "Attempted to stop the recording while currentTimelapseId is null");

        const timelapse = await deviceStorage.getTimelapse(currentTimelapseId);
        if (!timelapse)
          throw new Error(`Could not find a timelapse in IndexedDB with ID of ${currentTimelapseId}`);

        console.log("(upload) recording stopped!", timelapse);

        setUploadStage("Processing video...");
        setUploadProgress(5);

        const merged = await mergeVideoSessions(timelapse);

        console.log("(upload) - merged session data:", merged);

        setUploadStage("Generating thumbnail...");
        setUploadProgress(25);

        const thumbnail = await videoGenerateThumbnail(merged);

        console.log("(upload) thumbnail generated:", thumbnail);

        setUploadStage("Requesting upload URL...");
        setUploadProgress(30);
        const uploadRes = await trpc.timelapse.createDraft.query({ containerType: "WEBM" });
        console.log("(upload) timelapse.createDraft response:", uploadRes);

        if (!uploadRes.ok)
          throw new Error(uploadRes.message);

        setUploadStage("Encrypting video...");
        setUploadProgress(35);

        const encrypted = await encryptVideo(merged, uploadRes.data.id, (stage, progress) => {
          setUploadStage(stage);
          setUploadProgress(35 + Math.floor(progress * 0.25)); // 35-60%
        });

        console.log("(upload) - encrypted data:", encrypted);

        setUploadStage("Uploading video to server...");
        setUploadProgress(60);
        console.log("(upload) uploading video via proxy endpoint");

        const vidStatus = await apiUpload(
          uploadRes.data.videoToken,
          new Blob([encrypted.data], { type: "video/webm" })
        );

        if (!vidStatus.ok)
          throw new Error(vidStatus.message);

        setUploadProgress(80);

        console.log("(upload) video uploaded successfully", vidStatus);

        setUploadStage("Encrypting thumbnail...");
        setUploadProgress(75);

        const encryptedThumbnail = await encryptData(thumbnail, uploadRes.data.id, (stage, progress) => {
          setUploadStage(stage);
          setUploadProgress(75 + Math.floor(progress * 0.05)); // 75-80%
        });

        console.log("(upload) - encrypted thumbnail:", encryptedThumbnail);

        setUploadStage("Uploading thumbnail...");
        setUploadProgress(80);

        const thumbnailStatus = await apiUpload(
          uploadRes.data.thumbnailToken,
          new Blob([encryptedThumbnail.data], { type: "image/jpeg" })
        );
        if (!thumbnailStatus.ok)
          throw new Error(thumbnailStatus.message);

        console.log("(upload) thumbnail uploaded successfully", thumbnailStatus);

        setUploadStage("Finalizing timelapse...");
        setUploadProgress(85);
        const snapshots = await deviceStorage.getAllSnapshots();
        const snapshotTimestamps = snapshots.map(s => s.createdAt);

        const device = await getCurrentDevice();

        console.log("(upload) finalizing upload now!");
        console.log("(upload) - name:", name);
        console.log("(upload) - description:", description);
        console.log("(upload) - snapshots:", snapshotTimestamps);

        const createRes = await trpc.timelapse.commit.mutate({
          id: uploadRes.data.id,
          name,
          description,
          visibility: "UNLISTED",
          deviceId: device.id,
          snapshots: snapshotTimestamps,
        });

        console.log("(upload) timelapse.create response:", createRes);

        if (!createRes.ok)
          throw new Error(createRes.error);

        setUploadStage("Cleaning up local data...");
        setUploadProgress(95);
        console.log("(upload) timelapse created successfully! yay!");

        if (currentTimelapseId) {
          await deviceStorage.markComplete(currentTimelapseId);
          await deviceStorage.deleteAllSnapshots();
          await deviceStorage.deleteTimelapse(currentTimelapseId);
          setCurrentTimelapseId(null);
        }

        setUploadStage("Upload complete!");
        setUploadProgress(100);

        router.push(`/timelapse/${createRes.data.timelapse.id}`);
      }
      catch (apiErr) {
        console.error("(create.tsx) upload failed:", apiErr);
        setIsUploading(false);
        setError(apiErr instanceof Error ? apiErr.message : "An unknown error occurred during upload");
      }
    };

    recorder?.stop();
    setRecorder(null);
  }

  useEffect(() => {
    return () => {
      if (frameInterval) {
        clearInterval(frameInterval);
      }
    };
  }, [frameInterval]);

  async function discardRecording() {
    if (!window.confirm("Are you sure you want to discard this timelapse? This action cannot be undone."))
      return;

    try {
      if (frameInterval) {
        clearInterval(frameInterval);
        setFrameInterval(null);
      }

      if (recorder) {
        recorder.onstop = null;
        recorder.stop();
        setRecorder(null);
      }

      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        setCameraStream(null);
      }

      if (screenStream) {
        screenStream.getTracks().forEach((track) => track.stop());
        setScreenStream(null);
      }

      if (currentTimelapseId) {
        await deviceStorage.deleteAllSnapshots();
        await deviceStorage.deleteTimelapse(currentTimelapseId);
        setCurrentTimelapseId(null);
      }

      router.push("/");
    }
    catch (err) {
      console.error("(create.tsx) failed to discard timelapse:", err);
      setError(err instanceof Error ? err.message : "Failed to discard timelapse");
    }
  }

  function openSetupModal() {
    setSetupModalOpen(true);
    setFreeze(true);
  }

  function onSubmitModalClose() {
    if (!isCreated || !currentStream) {
      router.back();
    }
    else if (needsVideoSource) {
      setSetupModalOpen(true);
      alert("You must select a video source first.");
    }
    else {
      setSetupModalOpen(false);
      setFreeze(false);
    }
  }

  const isCreateDisabled = videoSourceKind === "NONE";
  const anyCamerasLoaded = availableCameras.filter(camera => camera.deviceId && camera.deviceId.length > 0).length > 0;

  return (
    <RootLayout showHeader={false}>
      <Modal isOpen={setupModalOpen}>
        <ModalHeader
          icon={isDiscarding ? "plus-fill" : "clock-fill"}
          title={
            isDiscarding ? "Create timelapse"
            : needsVideoSource ? "Resume timelapse"
            : isCreated ? "Update timelapse"
            : "Create timelapse"
          }
          description={
            isDiscarding ? "After you click Create, your timelapse will start recording!"
            : needsVideoSource ? "Select your video source to resume recording your timelapse."
            : isCreated ? "Update your timelapse settings."
            : "After you click Create, your timelapse will start recording!"
          }
          shortDescription={
            isDiscarding ? "Select a video source"
            : needsVideoSource ? "Select a video source to resume."
            : isCreated ? "Update your timelapse settings."
            : "Select a video source"
          }
          showCloseButton={true}
          onClose={onSubmitModalClose}
        />
        <ModalContent>
          <div className="overflow-x-hidden overflow-y-visible p-px -m-px">
            <div
              className={clsx(
                "flex transition-transform duration-200 ease-out",
                isDiscarding && "-translate-x-1/2"
              )}
              style={{ width: "200%" }}
            >
              {[false, true].map((panelIsDiscarding) => {
                const videoSourceDescription = panelIsDiscarding
                  ? <span className="text-red">This will permanently discard your previous timelapse.</span>
                  : "Record your screen, camera, or any other video source.";

                return (
                  <div key={panelIsDiscarding ? "discard" : "resume"} className={clsx("w-1/2 flex-shrink-0", panelIsDiscarding ? "pl-4" : "pr-4")}>
                    <div className="flex flex-col gap-6">
                      <DropdownInput
                        label="Video source"
                        description={videoSourceDescription}
                        value={videoSourceKind === "CAMERA" && selectedCameraId ? `CAMERA:${selectedCameraId}` : videoSourceKind}
                        onChange={(value) => onVideoSourceChange({ target: { value } } as ChangeEvent<HTMLSelectElement>)}
                        disabled={changingSource}
                        options={[
                          { value: "NONE", disabled: true, label: "(none)" },
                          { value: "SCREEN", icon: "photo", label: screenLabel },
                          ...(
                            anyCamerasLoaded
                            ? [
                              // We got permission from the user to fetch their cameras - display them.
                              {
                                label: "Cameras", icon: "instagram" as const, group: availableCameras
                                  .filter(camera => camera.deviceId && camera.deviceId.length > 0)
                                  .map((camera, index) => (
                                    {
                                      value: `CAMERA:${camera.deviceId}`,
                                      label: camera.label && camera.label.trim().length > 0
                                        ? camera.label.replace(/\([A-Fa-f0-9]+:[A-Fa-f0-9]+\)/, "").trim()
                                        : `Camera ${index + 1}`
                                    }
                                  ))
                              }
                            ] : [
                              // In this case, we didn't get permission to enumerate the user's cameras, so we'll display a generic "Camera"
                              // option, that when clicked, will prompt them for permission.
                              { label: "Camera", value: "CAMERA:" }
                            ])
                        ]}
                      />

                      {(cameraStream || screenStream) && (
                        <div className="flex flex-col gap-2">
                          <video
                            autoPlay
                            muted
                            className="h-auto rounded-md"
                            style={{ transform: videoSourceKind === "CAMERA" ? "scaleX(-1)" : "none" }}
                            ref={(el) => {
                              if (el && isDiscarding === panelIsDiscarding && el.srcObject !== currentStream) {
                                el.srcObject = currentStream;
                              }
                            }}
                          />
                        </div>
                      )}

                      <div className="flex gap-4 w-full">
                        {panelIsDiscarding ? (
                          <>
                            <Button onClick={() => setIsDiscarding(false)} kind="regular" icon="view-back">
                              Back
                            </Button>
                            <Button onClick={onCreate} disabled={isCreateDisabled} kind="primary" className="flex-1">
                              Create
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button onClick={onCreate} disabled={isCreateDisabled} kind="primary" className="flex-1">
                              {
                                needsVideoSource ? "Resume"
                                : isCreated ? "Update"
                                : "Create"
                              }
                            </Button>
                            {needsVideoSource && (
                              <Button onClick={() => setIsDiscarding(true)} kind="destructive" icon="delete">
                                Discard
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </ModalContent>
      </Modal>

      <WindowedModal
        icon="send-fill"
        title="Submit your timelapse"
        description="Submitting will end your timelapse and save all of your progress!"
        isOpen={submitModalOpen}
        setIsOpen={x => setSubmitModalOpen(x)}
      >
        <div className="flex flex-col gap-6">
          <TextInput
            field={{
              label: "Name",
              description: "The title of your timelapse. You can change it later!"
            }}
            value={name}
            onChange={setName}
            maxLength={60}
          />

          <TextareaInput
            label="Description"
            description="Displayed under your timelapse. Optional."
            value={description}
            onChange={setDescription}
            maxLength={280}
          />

          <div className="flex gap-4 w-full">
            <Button onClick={() => stopRecording()} disabled={!name || name.trim().length == 0} kind="primary">Submit</Button>
            <Button onClick={() => setSubmitModalOpen(false)} kind="regular">Cancel</Button>
            <Button onClick={discardRecording} kind="destructive" icon="delete">Discard</Button>
          </div>
        </div>
      </WindowedModal>

      <div className="flex w-screen h-screen bg-dark p-8 relative">
        {/* stats (overlay) */}
        <div className="z-10 absolute top-12 left-24 bg-dark shadow-xl text-xl font-mono font-bold px-8 py-4 flex gap-4 items-center border border-black rounded-[64px]">
          <div
            className={clsx(
              "rounded-full w-4 h-4",
              isRecording ? "bg-red animate-blink" : "bg-secondary"
            )}
          />

          <TimeSince active={isRecording} startTime={startedAt} initialElapsedSeconds={initialElapsedSeconds} />
        </div>

        {/* controls (overlay) */}
        <div className="z-10 absolute right-12 top-1/2 -translate-y-1/2 bg-dark border border-black rounded-[48px] shadow-xl px-2.5 py-11 flex flex-col gap-8">
          <PillControlButton onClick={toggleFreeze}>
            {isFrozen ? <RecordIcon className="p-3" width={48} height={48} /> : <PauseIcon className="p-3" width={48} height={48} />}
          </PillControlButton>

          <PillControlButton onClick={() => setSubmitModalOpen(true)}>
            <StopIcon className="p-3" width={48} height={48} />
          </PillControlButton>

          <PillControlButton onClick={() => setSetupModalOpen(true)}>
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
