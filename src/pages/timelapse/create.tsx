"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";

import { TimeSince } from "@/client/components/TimeSince";
import { Button } from "@/client/components/ui/Button";
import { InputField } from "@/client/components/ui/InputField";
import { Modal } from "@/client/components/ui/Modal";
import { TextareaInput } from "@/client/components/ui/TextareaInput";
import { TextInput } from "@/client/components/ui/TextInput";
import { deviceStorage, LocalTimelapse, LocalSnapshot, LocalChunk } from "@/client/deviceStorage";
import { createVideoProcessor, mergeVideoSessions, VideoProcessor } from "@/client/videoProcessing";
import { encryptVideoWithTimelapseId, getCurrentDevice } from "@/client/encryption";
import { trpc } from "@/client/trpc";
import { assert } from "@/shared/common";
import { TIMELAPSE_FRAME_LENGTH } from "@/shared/constants";
import { containerTypeToMimeType } from "@/server/routers/api/timelapse";
import { useOnce } from "@/client/hooks/useOnce";

export default function Page() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [setupModalOpen, setSetupModalOpen] = useState(true);
  const [isCreated, setIsCreated] = useState(false);
  const [videoSourceKind, setVideoSourceKind] = useState("NONE");
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraLabel, setCameraLabel] = useState("Camera");
  const [screenLabel, setScreenLabel] = useState("Screen");
  const [changingSource, setChangingSource] = useState(false);
  const [startedAt, setStartedAt] = useState(new Date());
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [frameInterval, setFrameInterval] = useState<NodeJS.Timeout | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [currentTimelapseId, setCurrentTimelapseId] = useState<number | null>(null);
  const [needsVideoSource, setNeedsVideoSource] = useState(false);
  const [currentSession] = useState<number>(Date.now());
  const [videoProcessor, setVideoProcessor] = useState<VideoProcessor | null>(null);
  const [initialElapsedSeconds, setInitialElapsedSeconds] = useState(0);

  const [isFrozen, setIsFrozen] = useState(false);
  const isFrozenRef = useRef(false);
  const frameCountRef = useRef(0);

  const setupPreviewRef = useRef<HTMLVideoElement>(null);
  const mainPreviewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chunksRef = useRef<LocalChunk[]>([]);

  const currentStream = cameraStream || screenStream;
  const isRecording = !isFrozen && !setupModalOpen;

  useOnce(async () => {
    setVideoProcessor(await createVideoProcessor());
  });

  useOnce(async () => {
    const activeTimelapse = await deviceStorage.getActiveTimelapse();
    if (!activeTimelapse) {
      console.log("No timelapse was started previously.");
      return;
    }

    console.group("An incomplete timelapse has been detected!");
    console.log("timelapse:", activeTimelapse);

    const snapshots = await deviceStorage.getAllSnapshots();
    console.log("snapshots:", snapshots);
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

      console.group("Sessions:");
      let totalElapsedTime = 0;
      for (const [session, sessionSnapshots] of sessionGroups) {
        if (sessionSnapshots.length > 1) {
          const sorted = sessionSnapshots.sort((a, b) => a.createdAt - b.createdAt);
          const sessionStart = sorted[0].createdAt;
          const sessionEnd = sorted[sorted.length - 1].createdAt;
          const sessionDuration = sessionEnd - sessionStart;
          totalElapsedTime += sessionDuration;
          
          console.log(`Session ${session}: ${sessionDuration}ms (${sessionSnapshots.length} snapshots)`);
        }
      }
      console.groupEnd();

      adjustedStartTime = new Date(Date.now() - totalElapsedTime);
      setInitialElapsedSeconds(Math.floor(totalElapsedTime / 1000));

      console.log("session groups:", sessionGroups);
      console.log("total elapsed time:", totalElapsedTime);
    }

    setName(activeTimelapse.name);
    setDescription(activeTimelapse.description);
    const lastFrameCount = snapshots.length;
    setFrameCount(lastFrameCount);
    frameCountRef.current = lastFrameCount;
    setCurrentTimelapseId(activeTimelapse.id);
    setStartedAt(adjustedStartTime);
    setIsCreated(true);

    chunksRef.current = activeTimelapse.chunks;

    setNeedsVideoSource(true);
    setSetupModalOpen(true);
  });

  useEffect(() => {
    (async () => {
      
    })();
  }, []);

  useEffect(() => {
    if (!setupPreviewRef.current)
      return;

    setupPreviewRef.current.srcObject = currentStream;
  }, [currentStream]);

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

    // Request data from MediaRecorder after drawing frame
    if (recorder && recorder.state === "recording") {
      recorder.requestData();
    }

    const activeTimelapseId = timelapseId ?? currentTimelapseId;
    if (activeTimelapseId == null)
      throw new Error("captureFrame() was called, but currentTimelapseId is null");

    const newFrameCount = frameCountRef.current;
    frameCountRef.current += 1;
    
    const snapshot: LocalSnapshot = {
      createdAt: Date.now(),
      session: currentSession
    };

    deviceStorage.saveSnapshot(snapshot);
    setFrameCount(newFrameCount);
  }, [recorder, currentTimelapseId, currentSession]);

  async function onCreate() {
    console.log("Creating a new timelapse!");

    mainPreviewRef.current!.srcObject = currentStream!;
    setSetupModalOpen(false);
    setNeedsVideoSource(false);

    let activeTimelapseId = currentTimelapseId;

    if (!currentTimelapseId) {
      // Creating a new timelapse

      const now = new Date();
      setStartedAt(now);
      setFrameCount(0);
      frameCountRef.current = 0;
      setIsCreated(true);

      const timelapseData: Omit<LocalTimelapse, "id"> = {
        name,
        description,
        startedAt: now.getTime(),
        chunks: [],
        isActive: true,
      };

      const timelapseId = await deviceStorage.saveTimelapse(timelapseData);
      setCurrentTimelapseId(timelapseId);
      activeTimelapseId = timelapseId;

      console.log(`New local timelapse created with ID ${timelapseId}`);
    }
    else {
      // Updating existing timelapse
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
      const stream = canvas.captureStream(1000 / TIMELAPSE_FRAME_LENGTH);

      const newRecorder = new MediaRecorder(stream);

      // For new timelapses, reset chunks; for existing ones, keep them
      if (!currentTimelapseId || !isCreated) {
        chunksRef.current = [];
      }

      newRecorder.ondataavailable = async (ev) => {
        if (ev.data.size <= 0)
          return;

        const storedChunk: LocalChunk = {
          data: ev.data,
          timestamp: Date.now(),
          session: currentSession
        };

        chunksRef.current.push(storedChunk);

        if (activeTimelapseId) {
          await deviceStorage.appendChunk(
            activeTimelapseId,
            ev.data,
            currentSession
          );
        }
      };

      setRecorder(newRecorder);
      newRecorder.start(TIMELAPSE_FRAME_LENGTH);

      if (frameInterval) {
        console.warn("Clearing previous frame capture interval.");
        clearInterval(frameInterval);
      }

      const newInterval = setInterval(
        () => captureFrame(activeTimelapseId!),
        TIMELAPSE_FRAME_LENGTH
      );
      
      setFrameInterval(newInterval);
    }
  }

  async function onVideoSourceChange(ev: ChangeEvent<HTMLSelectElement>) {
    if (ev.target.value == videoSourceKind)
      return; // no change

    if (changingSource) {
      console.warn("Attempted to change the video source while we're still processing a previous change. Ignoring.");
      return;
    }

    setChangingSource(true);

    function disposeStreams() {
      setCameraLabel("Camera");
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

    console.log("Video source changed to", ev.target.value);

    if (ev.target.value == "CAMERA") {
      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }
      catch (err) {
        console.error("Could not request permissions for camera stream.", err);
        setChangingSource(false);
        return;
      }

      console.log("Stream retrieved!", stream);

      const cameraLabel = stream
        .getVideoTracks()[0]
        .label.replace(/\([A-Fa-f0-9]+:[A-Fa-f0-9]+\)/, "")
        .trim();

      disposeStreams();
      setCameraStream(stream);
      setVideoSourceKind("CAMERA");
      setCameraLabel(`Camera (${cameraLabel})`);
    }
    else if (ev.target.value == "SCREEN") {
      let stream: MediaStream;

      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
      }
      catch (err) {
        console.error("Could not request permissions for screen capture.", err);
        setChangingSource(false);
        return;
      }

      console.log("Screen stream retrieved!", stream);

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
      setVideoSourceKind("NONE");
    }

    setChangingSource(false);
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
      console.warn("Attempted to stop the recording while recorder was null!");
      return;
    }

    recorder.onstop = async () => {
      assert(currentTimelapseId != null, "Attempted to stop the recording while currentTimelapseId is null");
      assert(videoProcessor != null, "Attempted to stop the recording while videoProcessor is null");

      const timelapse = await deviceStorage.getTimelapse(currentTimelapseId);
      if (!timelapse)
        throw new Error(`Could not find a timelapse in IndexedDB with ID of ${currentTimelapseId}`);

      console.log("(upload) recording stopped!", timelapse);

      const device = await getCurrentDevice();

      const merged = await mergeVideoSessions(videoProcessor, timelapse);
      console.log("(upload) - merged session data:", merged);

      const uploadRes = await trpc.timelapse.beginUpload.query({ containerType: "WEBM" });
      console.log("(upload) timelapse.beginUpload response:", uploadRes);

      if (!uploadRes.ok)
        throw new Error(uploadRes.error);

      const encrypted = await encryptVideoWithTimelapseId(merged, uploadRes.data.timelapseId);
      console.log("(upload) - encrypted data:", encrypted);

      console.log(`(upload) uploading now to ${uploadRes.data.url}`);

      const s3Res = await fetch(uploadRes.data.url, {
        method: "PUT",
        body: encrypted.data,
        headers: {
          "Content-Type": "video/webm",
        }
      });

      console.log("(upload) S3 response:", s3Res);

      if (!s3Res.ok)
        throw new Error(`S3 upload failed: ${s3Res.status} ${s3Res.statusText}`);

      const snapshots = await deviceStorage.getAllSnapshots();
      const snapshotTimestamps = snapshots.map(s => s.createdAt);

      console.log("(upload) finalizing upload now!");
      console.log("(upload) - name:", name);
      console.log("(upload) - description:", description);
      console.log("(upload) - snapshots:", snapshotTimestamps);

      const createRes = await trpc.timelapse.create.mutate({
        id: uploadRes.data.timelapseId,
        deviceId: device.id,
        snapshots: snapshotTimestamps,
        mutable: {
          name,
          description,
          privacy: "UNLISTED"
        }
      });

      console.log("(upload) timelapse.create response:", createRes);

      if (!createRes.ok)
        throw new Error(createRes.error);

      console.log("(upload) timelapse created successfully! yay!");

      if (currentTimelapseId) {
        await deviceStorage.markComplete(currentTimelapseId);
        await deviceStorage.deleteAllSnapshots();
        await deviceStorage.deleteTimelapse(currentTimelapseId);
        setCurrentTimelapseId(null);
      }

      router.push(`/timelapse/${createRes.data.timelapse.id}`);
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

  function openSetupModal() {
    setSetupModalOpen(true);
  }

  function onModalClose() {
    if (!isCreated) {
      router.back();
    }
    else {
      setSetupModalOpen(false);
    }
  }

  const isCreateDisabled = !name.trim() || videoSourceKind === "NONE";

  return (
    <>
      <Modal
        icon="clock-fill"
        title={
          needsVideoSource ? "Resume timelapse"
          : isCreated ? "Update timelapse"
          : "Create timelapse"
        }
        description={
          needsVideoSource ? "Select your video source to resume recording your timelapse."
          : isCreated ? "Update your timelapse settings."
          : "After you click Create, your timelapse will start recording!"
        }
        isOpen={setupModalOpen}
        setIsOpen={onModalClose}
      >
        <div className="flex flex-col gap-6">
          {!needsVideoSource && (
            <>
              <TextInput
                label="Name"
                description="The title of your timelapse. You can change it later!"
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
            </>
          )}

          <InputField
            label="Video source"
            description="Record your screen, camera, or any other video source."
          >
            <select
              className="border-1 border-sunken p-2 rounded-md disabled:bg-smoke transition-colors"
              value={videoSourceKind}
              onChange={onVideoSourceChange}
              disabled={changingSource}
            >
              <option disabled value="NONE">(none)</option>
              <option value="CAMERA">{cameraLabel}</option>
              <option value="SCREEN">{screenLabel}</option>
            </select>
          </InputField>

          {(cameraStream || screenStream) && (
            <div className="flex flex-col gap-2">
              <video
                ref={setupPreviewRef}
                autoPlay
                muted
                className="w-full h-auto border border-sunken rounded-md"
              />
            </div>
          )}

          <Button onClick={onCreate} disabled={isCreateDisabled} kind="primary">
            {
              needsVideoSource ? "Resume"
              : isCreated ? "Update"
              : "Create"
            }
          </Button>
        </div>
      </Modal>

      <div className="flex w-full h-screen bg-dark">
        <div
          className={"flex flex-col p-8 py-16 h-full gap-8 bg-dark text-smoke"}
        >
          <div className="flex gap-2 font-bold font-mono">
            <div>
              <div
                className={`rounded-full inline-block w-4 h-4 ${isRecording ? "bg-red" : "bg-muted"}`}
              ></div>
            </div>

            <div className="translate-y-[-2px]">
              {isRecording ? "REC" : "PAUSE"}{" "}
              <br></br>
              <TimeSince active={isRecording} startTime={startedAt} initialElapsedSeconds={initialElapsedSeconds} /> <br></br>
              <span className="opacity-70">
                {frameCount.toString().padStart(4, "0")}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-1">
            <Button
              kind={isFrozen ? "primary" : "secondary"}
              isSquare
              onClick={toggleFreeze}
            >
              <Icon glyph="freeze" size={56} />
            </Button>

            <div className="text-red font-bold font-mono">PAUSE</div>
          </div>

          <div className="flex flex-col items-center gap-1">
            <Button kind="secondary" isSquare onClick={() => openSetupModal()}>
              <Icon glyph="settings" size={56} />
            </Button>

            <div className="text-red font-bold font-mono">SETTINGS</div>
          </div>

          <div className="flex flex-col items-center gap-1">
            <Button kind="secondary" isSquare onClick={stopRecording}>
              <Icon glyph="send-fill" size={56} />
            </Button>

            <div className="text-red font-bold font-mono">END</div>
          </div>
        </div>

        <div className="w-full h-full py-12 pr-8">
          <div className="relative w-full h-full">
            <video
              ref={mainPreviewRef}
              autoPlay
              muted
              className="w-full h-full object-cover rounded-[48px]"
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>
        </div>
      </div>
    </>
  );
}
