import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import posthog from "posthog-js";
import { LookoutProvider, useLookout, formatTrackedTime } from "@lookout/react";
import type { CaptureMode } from "@lookout/react";

import type { IconGlyph } from "@/common";
import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { useInterval } from "@/hooks/useInterval";

import RootLayout from "@/components/layout/RootLayout";
import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { PillControlButton } from "@/components/ui/PillControlButton";

import RecordIcon from "@/assets/icons/record.svg";
import PauseIcon from "@/assets/icons/pause.svg";
import StopIcon from "@/assets/icons/stop.svg";

interface LookoutSessionConfig {
  lookoutToken: string;
  lookoutApiBaseUrl: string;
  timelapseId: string;
}

type RecordingMode = "desktop" | "screen" | "camera";

function RecordingModeOption({ icon, title, description, selected, onClick, recommended }: {
  icon: IconGlyph;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  recommended?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "relative flex flex-col items-center gap-3 p-6 w-full cursor-pointer transition-colors rounded-lg border",
        selected ? "bg-red text-white border-red" : "border-slate hover:bg-darkless"
      )}
    >
      {recommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-red text-white text-xs font-bold px-3 py-0.5 rounded-full uppercase tracking-wide">
          Recommended
        </span>
      )}
      <Icon glyph={icon} size={48} className="shrink-0" />
      <div className="flex flex-col items-center text-center gap-1">
        <span className="font-bold text-lg">{title}</span>
        <span className={clsx("text-sm", selected ? "text-white/80" : "text-muted")}>{description}</span>
      </div>
    </button>
  );
}

const CAPTURE_INTERVAL_MS = 60_000;

function TimePill({ formattedTime, isRecording, screenshotCount }: {
  formattedTime: string;
  isRecording: boolean;
  screenshotCount: number;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [pulsing, setPulsing] = useState(false);
  const prevCount = useRef(screenshotCount);

  useEffect(() => {
    if (screenshotCount > prevCount.current) {
      setPulsing(true);

      const bar = barRef.current;
      if (bar) {
        bar.style.transition = "none";
        bar.style.width = "0%";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            bar.style.transition = `width ${CAPTURE_INTERVAL_MS}ms linear`;
            bar.style.width = "100%";
          });
        });
      }
    }
    prevCount.current = screenshotCount;
  }, [screenshotCount]);

  useEffect(() => {
    if (!isRecording) return;
    const bar = barRef.current;
    if (!bar) return;
    bar.style.transition = `width ${CAPTURE_INTERVAL_MS}ms linear`;
    bar.style.width = "100%";
  }, [isRecording]);

  return (
    <div
      className={clsx(
        "z-10 absolute top-12 left-24 rounded-[64px]",
        pulsing && "animate-capture-pulse"
      )}
      onAnimationEnd={() => setPulsing(false)}
    >
      <div className="relative bg-dark shadow-xl text-xl font-mono font-bold px-8 py-4 flex gap-4 items-center border border-black rounded-[64px] overflow-hidden">
        <div
          className={clsx(
            "rounded-full w-4 h-4 shrink-0",
            isRecording ? "bg-red animate-blink" : "bg-secondary"
          )}
        />
        <span>{formattedTime}</span>
        {isRecording && (
          <div
            ref={barRef}
            className="absolute bottom-0 left-0 h-1 bg-red"
            style={{ width: "0%" }}
          />
        )}
      </div>
    </div>
  );
}

function CameraPickerPreview({ deviceId }: { deviceId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.play().catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      const video = videoRef.current;
      if (video) { video.pause(); video.srcObject = null; }
    };
  }, [deviceId]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      className="w-full aspect-video rounded-lg object-cover bg-darker"
      style={{ transform: "scaleX(-1)" }}
    />
  );
}

function cameraFacingIcon(label: string): IconGlyph | null {
  const l = label.toLowerCase();
  if (l.includes("front") || l.includes("user") || l.includes("facetime") || l.includes("selfie"))
    return "person";
  if (l.includes("back") || l.includes("rear") || l.includes("environment"))
    return "photo";
  return null;
}

function CameraPickerModal({ onSelect, onClose }: {
  onSelect: (deviceId: string) => void;
  onClose: () => void;
}) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === "videoinput");
        stream.getTracks().forEach(t => t.stop());

        if (videoDevices.length === 0) {
          setError("No cameras found.");
        } else if (videoDevices.length === 1) {
          onSelect(videoDevices[0].deviceId);
          return;
        } else {
          setCameras(videoDevices);
          setSelectedId(videoDevices[0].deviceId);
        }
      } catch {
        setError("Could not access camera. Check your browser permissions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [onSelect]);

  if (loading) {
    return (
      <RootLayout showHeader={false}>
        <LoadingModal isOpen title="Camera" message="Requesting camera access..." />
      </RootLayout>
    );
  }

  if (error) {
    return (
      <RootLayout showHeader={false}>
        <ErrorModal isOpen message={error} setIsOpen={() => {}} onClose={onClose} />
      </RootLayout>
    );
  }

  return (
    <RootLayout showHeader={false}>
      <Modal isOpen>
        <ModalHeader
          icon="camera"
          showCloseButton
          onClose={onClose}
          title="Select camera"
          description="Choose which camera to use for recording"
          shortDescription="Choose a camera"
        />
        <ModalContent>
          <div className="flex flex-col gap-4">
            {cameras.map((device, i) => {
              const facingIcon = cameraFacingIcon(device.label);
              return (
                <button
                  key={device.deviceId}
                  onClick={() => setSelectedId(device.deviceId)}
                  className={clsx(
                    "flex items-center gap-4 p-4 w-full cursor-pointer transition-colors rounded-lg border text-left",
                    selectedId === device.deviceId
                      ? "bg-red text-white border-red"
                      : "border-slate hover:bg-darkless"
                  )}
                >
                  {facingIcon && <Icon glyph={facingIcon} size={32} className="shrink-0" />}
                  <span className="font-bold">{device.label || `Camera ${i + 1}`}</span>
                </button>
              );
            })}

            {selectedId && <CameraPickerPreview deviceId={selectedId} />}

            <button
              onClick={() => selectedId && onSelect(selectedId)}
              className="w-full bg-red hover:bg-red/90 text-white font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
            >
              Continue
            </button>
          </div>
        </ModalContent>
      </Modal>
    </RootLayout>
  );
}

export default function LookoutRecorder() {
  useAuth(true);

  const router = useRouter();
  const [config, setConfig] = useState<LookoutSessionConfig | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<RecordingMode>("desktop");
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [pickingCamera, setPickingCamera] = useState(false);
  const sessionCreated = useRef(false);

  useEffect(() => {
    if (sessionCreated.current) return;
    sessionCreated.current = true;

    api.timelapse.createRecordingSession({}).then(res => {
      if (!res.ok) {
        setInitError(res.message);
        return;
      }
      setConfig({
        lookoutToken: res.data.lookoutToken,
        lookoutApiBaseUrl: res.data.lookoutApiBaseUrl,
        timelapseId: res.data.timelapseId,
      });
    }).catch(err => {
      setInitError(err instanceof Error ? err.message : "Failed to create recording session");
    });
  }, []);

  function handleStart() {
    if (!config) return;

    if (selectedMode === "desktop") {
      window.location.href = `lookout://session?token=${config.lookoutToken}`;
      return;
    }

    if (selectedMode === "camera") {
      setPickingCamera(true);
      return;
    }

    setCaptureMode(selectedMode);
  }

  function handleCameraSelected(deviceId: string) {
    setCameraDeviceId(deviceId);
    setPickingCamera(false);
    setCaptureMode("camera");
  }

  if (initError) {
    return (
      <RootLayout showHeader={false}>
        <ErrorModal isOpen message={initError} setIsOpen={() => {}} onClose={() => window.location.href = "/"} />
      </RootLayout>
    );
  }

  if (!config) {
    return (
      <RootLayout showHeader={false}>
        <LoadingModal isOpen title="Setting up" message="Creating recording session..." />
      </RootLayout>
    );
  }

  if (pickingCamera) {
    return (
      <CameraPickerModal
        onSelect={handleCameraSelected}
        onClose={() => setPickingCamera(false)}
      />
    );
  }

  if (captureMode) {
    return (
      <LookoutProvider
        token={config.lookoutToken}
        apiBaseUrl={config.lookoutApiBaseUrl}
        appName="Lapse"
        capture={captureMode === "camera"
          ? { mode: "camera", camera: cameraDeviceId ? { deviceId: cameraDeviceId } : undefined }
          : undefined
        }
      >
        <LapseRecorder
          timelapseId={config.timelapseId}
          onShareFailed={() => { setCaptureMode(null); setCameraDeviceId(null); }}
        />
      </LookoutProvider>
    );
  }

  return (
    <RootLayout showHeader={false}>
      <Modal isOpen>
        <ModalHeader
          icon="clock-fill"
          showCloseButton={true}
          onClose={() => router.back()}
          title="Create timelapse"
          description="How would you like to record?"
          shortDescription="Choose a recording mode"
        />
        <ModalContent>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row gap-4 w-full">
              <RecordingModeOption
                icon="laptop"
                title="Desktop"
                description="Open in Lookout app"
                selected={selectedMode === "desktop"}
                onClick={() => setSelectedMode("desktop")}
                recommended
              />
              <RecordingModeOption
                icon="web"
                title="Browser"
                description="Share your screen"
                selected={selectedMode === "screen"}
                onClick={() => setSelectedMode("screen")}
              />
              <RecordingModeOption
                icon="camera"
                title="Camera"
                description="Use your webcam"
                selected={selectedMode === "camera"}
                onClick={() => setSelectedMode("camera")}
              />
            </div>

            <button
              onClick={handleStart}
              className="w-full bg-red hover:bg-red/90 text-white font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
            >
              {selectedMode === "desktop" ? "Open Lookout" : "Start Recording"}
            </button>
          </div>
        </ModalContent>
      </Modal>
    </RootLayout>
  );
}

function CameraPreviewVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
    return () => {
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      className="max-h-full rounded-[48px] object-contain"
      style={{ transform: "scaleX(-1)" }}
    />
  );
}

function LapseRecorder({ timelapseId, onShareFailed }: {
  timelapseId: string;
  onShareFailed: () => void;
}) {
  const router = useRouter();
  const { state, actions } = useLookout();
  const [error, setError] = useState<string | null>(null);
  const [captureFailed, setCaptureFailed] = useState(false);
  const screenStarted = useRef(false);
  const isCamera = state.captureMode === "camera";

  // Camera: auto-start preview (mirrors Fallout's BrowserRecorderUI)
  useEffect(() => {
    if (isCamera && !state.isPreviewing && !state.isSharing) {
      actions.startPreview().catch(() => setCaptureFailed(true));
    }
  }, [isCamera, state.status, state.isPreviewing, state.isSharing]);

  // Screen: auto-start sharing on mount
  useEffect(() => {
    if (isCamera) return;
    if (screenStarted.current) return;
    screenStarted.current = true;
    actions.startSharing().then(() => {
      posthog.capture("lookout_recording_started");
    });
  }, [isCamera, actions]);

  // Detect SDK-level errors
  useEffect(() => {
    if (state.status === "error") setCaptureFailed(true);
  }, [state.status]);

  // Return to mode selection on failure (screen mode only — camera shows inline error)
  useEffect(() => {
    if (!isCamera && state.error && !state.isSharing) {
      onShareFailed();
    }
  }, [isCamera, state.error, state.isSharing, onShareFailed]);

  useEffect(() => {
    document.title = state.status === "paused" ? "⏸️ PAUSED"
      : state.isRecording ? "🔴 REC"
      : "Lapse";
  }, [state.status, state.isRecording]);

  useInterval(async () => {
    if (state.isRecording) {
      await api.user.emitHeartbeat({});
    }
  }, 30 * 1000);

  useEffect(() => {
    if (state.status === "stopped" || state.status === "compiling" || state.status === "complete") {
      router.push(`/timelapse/publish/${timelapseId}`);
    }
  }, [state.status, timelapseId, router]);

  function handleStartSharing() {
    actions.startSharing().then(() => {
      posthog.capture("lookout_recording_started");
    }).catch(() => setCaptureFailed(true));
  }

  async function togglePause() {
    if (state.status === "paused") {
      await actions.resume();
    } else {
      await actions.pause();
    }
  }

  async function stopRecording() {
    try {
      await actions.stop();
      posthog.capture("lookout_recording_stopped");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop recording");
    }
  }

  if (captureFailed) {
    return (
      <RootLayout showHeader={false}>
        <ErrorModal
          isOpen
          message="Capture failed. Please check your permissions and try again."
          setIsOpen={() => {}}
          onClose={onShareFailed}
        />
      </RootLayout>
    );
  }

  // Camera preview phase — show preview and "Start Recording" button
  if (isCamera && state.isPreviewing && !state.isSharing) {
    const formattedTime = formatTrackedTime(state.displaySeconds);
    return (
      <RootLayout showHeader={false}>
        <div className="flex w-screen h-screen bg-dark p-8 relative">
          <TimePill formattedTime={formattedTime} isRecording={false} screenshotCount={0} />

          <div className="z-10 absolute right-12 top-1/2 -translate-y-1/2 bg-dark border border-black rounded-[48px] shadow-xl px-2.5 py-11 flex flex-col gap-8">
            <PillControlButton onClick={handleStartSharing}>
              <RecordIcon className="p-3" width={48} height={48} />
            </PillControlButton>

            <PillControlButton onClick={onShareFailed}>
              <StopIcon className="p-3" width={48} height={48} />
            </PillControlButton>
          </div>

          <div className="w-full h-full flex justify-center items-center">
            {state.previewStream ? (
              <CameraPreviewVideo stream={state.previewStream} />
            ) : (
              <div className="text-secondary text-lg">Starting camera...</div>
            )}
          </div>
        </div>
      </RootLayout>
    );
  }

  const formattedTime = formatTrackedTime(state.displaySeconds);

  return (
    <RootLayout showHeader={false}>
      <div className="flex w-screen h-screen bg-dark p-8 relative">
        <TimePill formattedTime={formattedTime} isRecording={state.isRecording} screenshotCount={state.screenshotCount} />

        <div className="z-10 absolute right-12 top-1/2 -translate-y-1/2 bg-dark border border-black rounded-[48px] shadow-xl px-2.5 py-11 flex flex-col gap-8">
          <PillControlButton onClick={togglePause}>
            {state.status === "paused"
              ? <RecordIcon className="p-3" width={48} height={48} />
              : <PauseIcon className="p-3" width={48} height={48} />}
          </PillControlButton>

          <PillControlButton onClick={stopRecording}>
            <StopIcon className="p-3" width={48} height={48} />
          </PillControlButton>
        </div>

        <div className="w-full h-full flex justify-center items-center">
          {isCamera && state.previewStream ? (
            <CameraPreviewVideo stream={state.previewStream} />
          ) : state.lastScreenshotUrl ? (
            <img
              src={state.lastScreenshotUrl}
              alt="Latest capture"
              className="max-h-full rounded-[48px] object-contain"
            />
          ) : (
            <div className="text-secondary text-lg">
              {state.isSharing ? "Waiting for first screenshot..." : ""}
            </div>
          )}
        </div>
      </div>

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onClose={() => router.back()}
      />
    </RootLayout>
  );
}
