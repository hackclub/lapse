import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";

import { TimeSince } from "@/client/components/TimeSince";
import { Button } from "@/client/components/ui/Button";
import { InputField } from "@/client/components/ui/InputField";
import { Modal } from "@/client/components/ui/Modal";
import { TextareaInput } from "@/client/components/ui/TextareaInput";
import { TextInput } from "@/client/components/ui/TextInput";
import {
  timelapseStorage,
  StoredTimelapse,
  StoredSnapshot,
  StoredChunk,
} from "@/client/timelapseStorage";
import { videoProcessor } from "@/client/videoProcessing";

const FRAME_INTERVAL_MS = 1 * 1000; // 60 seconds

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
  const [frameInterval, setFrameInterval] = useState<NodeJS.Timeout | null>(
    null
  );
  const [frameCount, setFrameCount] = useState(0);
  const [currentTimelapseId, setCurrentTimelapseId] = useState<number | null>(
    null
  );
  const [isRecovering, setIsRecovering] = useState(false);
  const [needsVideoSource, setNeedsVideoSource] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");

  const [isFrozen, setIsFrozen] = useState(false);
  const isFrozenRef = useRef(false);

  const setupPreviewRef = useRef<HTMLVideoElement>(null);
  const mainPreviewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chunksRef = useRef<StoredChunk[]>([]);

  const currentStream = cameraStream || screenStream;
  const isRecording = !isFrozen && !setupModalOpen;

  useEffect(() => {
    (async () => {
      setIsRecovering(true);

      try {
        const activeTimelapse = await timelapseStorage.getActiveTimelapse();
        if (activeTimelapse) {
          const snapshots = await timelapseStorage.getSnapshotsForTimelapse(
            activeTimelapse.id
          );

          let adjustedStartTime = new Date(activeTimelapse.startedAt);
          if (snapshots.length > 0) {
            const sortedSnapshots = snapshots.sort(
              (a, b) => a.createdAt - b.createdAt
            );
            const firstSnapshot = sortedSnapshots[0];
            const lastSnapshot = sortedSnapshots[sortedSnapshots.length - 1];

            const timeElapsed =
              lastSnapshot.createdAt - firstSnapshot.createdAt;

            adjustedStartTime = new Date(Date.now() - timeElapsed);
          }

          setName(activeTimelapse.name);
          setDescription(activeTimelapse.description);
          setFrameCount(activeTimelapse.frameCount);
          setCurrentTimelapseId(activeTimelapse.id);
          setStartedAt(adjustedStartTime);
          setIsCreated(true);

          chunksRef.current = activeTimelapse.chunks;

          // Generate new session ID for this recording session
          setCurrentSessionId(`session_${Date.now()}`);

          setNeedsVideoSource(true);
          setSetupModalOpen(true);

          console.log(`Existing timelapse ${activeTimelapse.name} loaded!`);
          console.log("  data:", activeTimelapse);
          console.log("  snapshots:", snapshots);
        }
      }
      catch (error) {
        console.error("Failed to recover timelapse:", error);
      }
      finally {
        setIsRecovering(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!setupPreviewRef.current) return;

    setupPreviewRef.current.srcObject = currentStream;
  }, [currentStream]);

  const captureFrame = useCallback(async () => {
    if (isFrozenRef.current) return;

    const video = mainPreviewRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // Request data from MediaRecorder after drawing frame
    if (recorder && recorder.state === "recording") {
      recorder.requestData();
    }

    setFrameCount((prev) => {
      const newFrameCount = prev + 1;

      if (currentTimelapseId) {
        timelapseStorage.updateFrameCount(currentTimelapseId, newFrameCount);

        const snapshot: Omit<StoredSnapshot, "id"> = {
          frame: newFrameCount,
          createdAt: Date.now(),
          timelapseId: currentTimelapseId,
        };

        timelapseStorage.saveSnapshot(snapshot as StoredSnapshot);
      }

      return newFrameCount;
    });
  }, [recorder, currentTimelapseId]);

  async function onCreate() {
    mainPreviewRef.current!.srcObject = currentStream!;
    setSetupModalOpen(false);
    setNeedsVideoSource(false);

    let activeTimelapseId = currentTimelapseId;

    if (!currentTimelapseId) {
      // Creating a new timelapse

      const now = new Date();
      setStartedAt(now);
      setFrameCount(0);
      setIsCreated(true);

      // Generate session ID for new timelapse
      const sessionId = `session_${now.getTime()}`;
      setCurrentSessionId(sessionId);

      const timelapseData: Omit<StoredTimelapse, "id"> = {
        name,
        description,
        startedAt: now.getTime(),
        chunks: [],
        frameCount: 0,
        isActive: true,
      };

      const timelapseId = await timelapseStorage.saveTimelapse(timelapseData);
      setCurrentTimelapseId(timelapseId);
      activeTimelapseId = timelapseId;
    }
    else {
      // Updating existing timelapse
      if (currentTimelapseId) {
        const existingTimelapse = await timelapseStorage.getTimelapse(
          currentTimelapseId
        );

        if (existingTimelapse) {
          existingTimelapse.name = name;
          existingTimelapse.description = description;
          await timelapseStorage.saveTimelapse(existingTimelapse);
        }
      }
    }

    // Only set up recording if not already active (for new timelapses or resumed ones)
    if (!recorder || recorder.state === "inactive") {
      const canvas = canvasRef.current!;
      const stream = canvas.captureStream(24);

      const newRecorder = new MediaRecorder(stream);

      // For new timelapses, reset chunks; for existing ones, keep them
      if (!currentTimelapseId || !isCreated) {
        chunksRef.current = [];
      }

      newRecorder.ondataavailable = async (ev) => {
        if (ev.data.size <= 0) return;

        const storedChunk: StoredChunk = {
          data: ev.data,
          timestamp: Date.now(),
          sessionId: currentSessionId,
        };

        chunksRef.current.push(storedChunk);

        if (activeTimelapseId) {
          await timelapseStorage.appendChunk(
            activeTimelapseId,
            ev.data,
            currentSessionId
          );
        }
      };

      setRecorder(newRecorder);
      newRecorder.start(FRAME_INTERVAL_MS);

      setFrameInterval(setInterval(captureFrame, FRAME_INTERVAL_MS));
    }

    console.log("Timelapse recording started!", recorder);
  }

  async function onVideoSourceChange(ev: ChangeEvent<HTMLSelectElement>) {
    if (ev.target.value == videoSourceKind) return; // no change

    if (changingSource) {
      console.warn(
        "Attempted to change the video source while we're still processing a previous change. Ignoring."
      );
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

    if (recorder) {
      recorder.onstop = async () => {
        let allChunks: StoredChunk[] = [];

        if (currentTimelapseId) {
          const timelapse = await timelapseStorage.getTimelapse(
            currentTimelapseId
          );

          if (timelapse) {
            allChunks = timelapse.chunks;
          }
        }

        // Fallback to in-memory chunks if no stored chunks
        if (allChunks.length === 0) {
          allChunks = chunksRef.current;
        }

        if (allChunks.length === 0) return;

        console.log("Processing video chunks with FFmpeg!", allChunks);

        try {
          // Try FFmpeg processing first
          const blobs = allChunks.map((chunk) => chunk.data);
          let finalBlob: Blob;

          try {
            // Initialize video processor
            await videoProcessor.initialize();

            // Extract blob data and timestamps from stored chunks
            const timestamps = allChunks.map((chunk) => chunk.timestamp);

            // Classify chunks into sessions and concatenate
            const sessions = videoProcessor.classifyChunks(blobs, timestamps);
            console.log(`Classified into ${sessions.length} video sessions`);

            if (sessions.length > 1) {
              // Multiple sessions - use FFmpeg for proper concatenation
              finalBlob = await videoProcessor.concatenateVideoSessions(sessions);
            }
            else {
              // Single session - direct concatenation is sufficient
              finalBlob = await videoProcessor.concatenateChunksDirectly(blobs);
            }
            
            console.log("Video processing completed with FFmpeg");
          }
          catch (ffmpegError) {
            console.warn("FFmpeg processing failed, falling back to simple concatenation:", ffmpegError);
            // Fallback to simple blob concatenation
            finalBlob = new Blob(blobs, { type: "video/webm" });
          }

          const url = URL.createObjectURL(finalBlob);

          // Create download link
          const a = document.createElement("a");
          a.style.display = "none";
          a.href = url;
          a.download = `timelapse-${new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, "-")}.webm`;

          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          // Clean up
          URL.revokeObjectURL(url);

          // Mark timelapse as complete and clean up from IndexedDB
          if (currentTimelapseId) {
            await timelapseStorage.markComplete(currentTimelapseId);
            await timelapseStorage.deleteSnapshotsForTimelapse(
              currentTimelapseId
            );
            await timelapseStorage.deleteTimelapse(currentTimelapseId);
            setCurrentTimelapseId(null);
          }
        }
        catch (error) {
          console.error("Failed to process video with FFmpeg:", error);
          // Fallback to simple blob concatenation
          const blobs = allChunks.map((chunk) => chunk.data);
          const blob = new Blob(blobs, { type: "video/webm" });
          const url = URL.createObjectURL(blob);

          const a = document.createElement("a");
          a.style.display = "none";
          a.href = url;
          a.download = `timelapse-${new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/:/g, "-")}.webm`;

          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          URL.revokeObjectURL(url);
        }
      };

      recorder.stop();
    }

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
          needsVideoSource
            ? "Resume timelapse"
            : isCreated
            ? "Update timelapse"
            : "Create timelapse"
        }
        description={
          needsVideoSource
            ? "Select your video source to resume recording your timelapse."
            : isCreated
            ? "Update your timelapse settings."
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
              <option disabled value="NONE">
                (none)
              </option>
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
            {needsVideoSource ? "Resume" : isCreated ? "Update" : "Create"}
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
                className={`rounded-full inline-block w-4 h-4 ${
                  isRecording ? "bg-red" : "bg-muted"
                }`}
              ></div>
            </div>

            <div className="translate-y-[-2px]">
              {isRecovering ? "RECOVERING" : isRecording ? "REC" : "PAUSE"}{" "}
              <br></br>
              <TimeSince active={isRecording} startTime={startedAt} /> <br></br>
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
