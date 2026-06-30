import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import { LookoutProvider, useLookout } from "@lookout/react";
import type { CaptureMode } from "@lookout/react";

import type { IconGlyph } from "@/common";
import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { useInterval } from "@/hooks/useInterval";
import {
  type StoredLookoutSession,
  storeSession,
  removeStoredSession,
} from "@/components/lookout/sessions";
import RootLayout from "@/components/layout/RootLayout";
import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { PillControlButton } from "@/components/ui/PillControlButton";

function formatTrackedTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
}

import RecordIcon from "@/assets/icons/record.svg";
import PauseIcon from "@/assets/icons/pause.svg";
import StopIcon from "@/assets/icons/stop.svg";

interface LookoutSessionConfig {
  draftId: string;
  lookoutToken: string;
  lookoutApiBaseUrl: string;
  lookoutSessionId: string;
}

type RecordingMode = "desktop" | "screen" | "camera";

function RecordingModeOption({ icon, title, description, selected, onClick, recommended, dimmed }: {
  icon: IconGlyph;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  recommended?: boolean;
  dimmed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "relative flex flex-col items-center gap-3 p-6 w-full cursor-pointer transition-colors rounded-lg border",
        selected ? "bg-red text-white border-red" : "border-slate hover:bg-darkless",
        dimmed && !selected && "opacity-40"
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

const CAPTURE_INTERVAL_S = 60;

function TimePill({ formattedTime, isRecording, displaySeconds }: {
  formattedTime: string;
  isRecording: boolean;
  displaySeconds: number;
}) {
  const [pulsing, setPulsing] = useState(false);
  const prevCycle = useRef(Math.floor(displaySeconds / CAPTURE_INTERVAL_S));

  const currentCycle = Math.floor(displaySeconds / CAPTURE_INTERVAL_S);
  useEffect(() => {
    if (currentCycle > prevCycle.current) {
      setPulsing(true);
    }
    prevCycle.current = currentCycle;
  }, [currentCycle]);

  const cycleProgress = (displaySeconds % CAPTURE_INTERVAL_S) / CAPTURE_INTERVAL_S;

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
            className="absolute bottom-1 left-8 right-8 h-1 rounded-full bg-white/10 overflow-hidden"
          >
            <div
              className="h-full bg-red rounded-full transition-[width] duration-1000 linear"
              style={{ width: `${cycleProgress * 100}%` }}
            />
          </div>
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

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type ServerDraft = {
  id: string;
  createdAt: number;
  lookoutSessionId: string;
  lookoutToken: string;
  lookoutStatus: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
};

function SessionSelector({ onSelectSession, onNewSession, onClose }: {
  onSelectSession: (session: StoredLookoutSession) => void;
  onNewSession: () => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<ServerDraft[]>([]);
  const [lookoutApiBaseUrl, setLookoutApiBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.timelapse.getLookoutDrafts({}).then(res => {
      if (res.ok) {
        setDrafts(res.data.drafts);
        setLookoutApiBaseUrl(res.data.lookoutApiBaseUrl);
      }
    }).finally(() => setLoading(false));
  }, []);

  function handleContinue(draft: ServerDraft) {
    onSelectSession({
      draftId: draft.id,
      lookoutToken: draft.lookoutToken,
      lookoutApiBaseUrl: lookoutApiBaseUrl,
      lookoutSessionId: draft.lookoutSessionId,
      createdAt: draft.createdAt,
    });
  }

  async function handleDiscard(draftId: string) {
    setBusy(draftId);
    await api.timelapse.discardLookoutDraft({ id: draftId });
    removeStoredSession(draftId);
    setDrafts(drafts.filter(d => d.id !== draftId));
    setBusy(null);

    if (drafts.length <= 1) {
      onNewSession();
    }
  }

  const isReady = (d: ServerDraft) => d.lookoutStatus === "complete" || d.lookoutStatus === "stopped" || d.lookoutStatus === "compiling";

  return (
    <Modal isOpen>
      <ModalHeader
        icon="clock-fill"
        showCloseButton
        onClose={onClose}
        title="Resume session"
        description="Pick an existing session or start a new one"
        shortDescription="Select a session"
      />
      <ModalContent>
        {loading ? (
          <p className="text-muted text-center">Loading drafts...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {drafts.map(draft => (
              <div
                key={draft.id}
                className={clsx(
                  "flex flex-col items-center gap-3 p-4 w-full rounded-lg border border-slate overflow-hidden",
                  busy !== null && "opacity-50 pointer-events-none"
                )}
              >
                {draft.thumbnailUrl ? (
                  <img src={draft.thumbnailUrl} alt="" className="w-full aspect-video rounded-md object-cover" />
                ) : (
                  <div className="w-full aspect-video rounded-md bg-darker flex items-center justify-center">
                    <Icon glyph="clock-fill" size={48} className="text-muted" />
                  </div>
                )}

                <div className="flex flex-col items-center text-center gap-1">
                  <span className="font-bold">
                    {isReady(draft) ? "Ready to publish" : "Recording in progress"}
                  </span>
                  <span className="text-sm text-muted">
                    {timeAgo(draft.createdAt)}
                  </span>
                </div>

                <div className="flex gap-2 w-full">
                  {isReady(draft) ? (
                    <>
                      <button
                        onClick={() => window.location.href = `/timelapse/publish/${draft.id}`}
                        className="flex-1 bg-red hover:bg-red/90 text-white font-bold py-2 px-4 rounded-lg transition-colors cursor-pointer text-sm"
                      >
                        Publish
                      </button>
                      <button
                        onClick={() => handleContinue(draft)}
                        className="flex-1 border border-slate hover:bg-darkless font-bold py-2 px-4 rounded-lg transition-colors cursor-pointer text-sm"
                      >
                        Continue
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleContinue(draft)}
                        className="flex-1 bg-red hover:bg-red/90 text-white font-bold py-2 px-4 rounded-lg transition-colors cursor-pointer text-sm"
                      >
                        Continue
                      </button>
                      <button
                        onClick={() => handleDiscard(draft.id)}
                        className="flex-1 border border-red text-red hover:bg-red/10 font-bold py-2 px-4 rounded-lg transition-colors cursor-pointer text-sm"
                      >
                        Discard
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}

            <div
              role="button"
              tabIndex={0}
              onClick={() => busy === null && onNewSession()}
              onKeyDown={(e) => e.key === "Enter" && busy === null && onNewSession()}
              className={clsx(
                "flex flex-col items-center justify-center gap-3 p-4 w-full cursor-pointer transition-colors rounded-lg border border-dashed border-slate hover:bg-darkless",
                busy !== null && "opacity-50 pointer-events-none"
              )}
              style={{ minHeight: "10rem" }}
            >
              <Icon glyph="plus" size={48} className="text-muted" />
              <span className="font-bold">New session</span>
            </div>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}

/**
 * Request the screen-share stream *now*, from within a user gesture, and make
 * the Lookout SDK reuse it.
 *
 * WebKit/Safari rejects getDisplayMedia unless the call itself originates
 * directly from a user gesture — it does not honour the transient-activation
 * window Chrome allows. But the SDK calls getDisplayMedia from a mount effect,
 * which only runs after we've created a session over the network — long past
 * the gesture. So instead of blocking on session creation, we fire
 * getDisplayMedia here on the click (kicking off the OS picker immediately,
 * while the session request flies in parallel) and briefly shim
 * navigator.mediaDevices.getDisplayMedia so the SDK's later call resolves to
 * the stream we already requested. The shim is one-shot and self-restoring.
 *
 * Returns a cleanup() that restores the original getDisplayMedia and stops the
 * stream — call it if recording never actually starts (e.g. session creation
 * failed) so we don't leak a live screen-share or a dangling override.
 */
function primeScreenShare(): () => void {
  const md = navigator.mediaDevices;
  const real = md.getDisplayMedia.bind(md);

  // Plain { video: true } so the call never rejects with a TypeError on older
  // Safari (which chokes on nested frameRate constraints). The SDK downscales
  // captured frames itself, so we don't lose any output fidelity here.
  const streamPromise = real({ video: true, audio: false });
  // The SDK may never consume this (cancelled flow) — swallow so a rejected
  // picker doesn't surface as an unhandled promise rejection.
  streamPromise.catch(() => {});

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (md.getDisplayMedia === shim) md.getDisplayMedia = real;
  };
  const shim: MediaDevices["getDisplayMedia"] = () => {
    restore();
    return streamPromise;
  };
  md.getDisplayMedia = shim;

  return () => {
    restore();
    streamPromise.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
  };
}

export default function LookoutRecorder() {
  const auth = useAuth(true);

  const router = useRouter();
  const [config, setConfig] = useState<LookoutSessionConfig | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<RecordingMode>("desktop");
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [pickingCamera, setPickingCamera] = useState(false);
  const [desktopLaunched, setDesktopLaunched] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [hasDrafts, setHasDrafts] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"checking" | "selecting" | "ready">("checking");
  // Set when a previous Browser (screen) capture failed. Drives the warning blurb,
  // the dimmed Browser option, and the "are you sure?" confirmation on the selector.
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [confirmingBrowser, setConfirmingBrowser] = useState(false);
  const initialized = useRef(false);
  // Cleanup for an in-gesture screen-share primed by primeScreenShare(): stops
  // the stream and restores getDisplayMedia if the SDK never consumed it.
  const primeCleanupRef = useRef<(() => void) | null>(null);

  const releasePendingStream = useCallback(() => {
    primeCleanupRef.current?.();
    primeCleanupRef.current = null;
  }, []);

  const checkLookoutDrafts = useCallback(async () => {
    try {
      const res = await api.timelapse.getLookoutDrafts({});
      if (res.ok && res.data.drafts.length > 0) {
        setHasDrafts(true);
        setPhase("selecting");
      } else {
        setHasDrafts(false);
        setPhase("ready");
      }
    } catch {
      setHasDrafts(false);
      setPhase("ready");
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    if (auth.isLoading || !auth.currentUser) return;
    initialized.current = true;

    // Legacy recordings (unfinished OPFS captures or unpublished drafts) are recovered from the dedicated
    // `/timelapse/recover` page, surfaced by the site-wide banner - not from the create flow.
    checkLookoutDrafts();
  }, [auth.isLoading, auth.currentUser, checkLookoutDrafts]);

  async function createSessionAndStart(onReady: (cfg: LookoutSessionConfig) => void) {
    setIsCreating(true);
    try {
      const res = await api.timelapse.createRecordingSession({});
      if (!res.ok) {
        setInitError(res.message);
        releasePendingStream();
        return;
      }
      if (!res.data.draftId) {
        setInitError("Server returned no draft ID. Please restart the server.");
        releasePendingStream();
        return;
      }
      const cfg: LookoutSessionConfig = {
        draftId: res.data.draftId,
        lookoutToken: res.data.lookoutToken,
        lookoutApiBaseUrl: res.data.lookoutApiBaseUrl,
        lookoutSessionId: res.data.lookoutSessionId,
      };
      setConfig(cfg);
      storeSession({
        draftId: cfg.draftId,
        lookoutToken: cfg.lookoutToken,
        lookoutApiBaseUrl: cfg.lookoutApiBaseUrl,
        lookoutSessionId: cfg.lookoutSessionId,
        createdAt: Date.now(),
      });
      onReady(cfg);
    } catch (err) {
      setInitError(err instanceof Error ? err.message : "Failed to create recording session");
      releasePendingStream();
    } finally {
      setIsCreating(false);
    }
  }

  function handleResumeSession(session: StoredLookoutSession) {
    const cfg: LookoutSessionConfig = {
      draftId: session.draftId,
      lookoutToken: session.lookoutToken,
      lookoutApiBaseUrl: session.lookoutApiBaseUrl,
      lookoutSessionId: session.lookoutSessionId,
    };
    setConfig(cfg);
    storeSession({
      ...session,
      createdAt: Date.now(),
    });
    setPhase("ready");
  }

  function handleStart() {
    // If Browser failed last time, make the user actively confirm before retrying it.
    if (selectedMode === "screen" && browserError && !confirmingBrowser) {
      setConfirmingBrowser(true);
      return;
    }
    setConfirmingBrowser(false);

    // For Browser (screen) mode, request the screen-share *synchronously* here
    // in the click — Safari requires getDisplayMedia to fire from the gesture
    // itself. primeScreenShare pops the OS picker now and hands the stream to
    // the SDK when it asks; meanwhile session creation runs in the background.
    if (selectedMode === "screen") {
      try {
        primeCleanupRef.current = primeScreenShare();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setBrowserError(e.message || "Failed to start screen sharing.");
        setSelectedMode("desktop");
        return;
      }
    }

    if (config) {
      startWithConfig(config);
      return;
    }

    createSessionAndStart(startWithConfig);
  }

  function startWithConfig(cfg: LookoutSessionConfig) {
    if (selectedMode === "desktop") {
      window.location.href = `lookout://session?token=${cfg.lookoutToken}`;
      setDesktopLaunched(true);
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
    if (config) {
      setCaptureMode("camera");
    } else {
      createSessionAndStart(() => setCaptureMode("camera"));
    }
  }

  if (phase === "checking") {
    return (
      <RootLayout showHeader={false}>
        <div className="flex items-center justify-center h-screen text-muted">Checking for sessions...</div>
      </RootLayout>
    );
  }

  if (phase === "selecting" && hasDrafts) {
    return (
      <RootLayout showHeader={false}>
        <SessionSelector
          onSelectSession={handleResumeSession}
          onNewSession={() => { setHasDrafts(false); setPhase("ready"); }}
          onClose={() => router.back()}
        />
      </RootLayout>
    );
  }

  if (initError) {
    return (
      <RootLayout showHeader={false}>
        <ErrorModal isOpen message={initError} setIsOpen={() => {}} onClose={() => window.location.href = "/"} />
      </RootLayout>
    );
  }

  if (desktopLaunched && config) {
    return (
      <RootLayout showHeader={false}>
        <div className="flex w-screen h-screen items-center justify-center p-8">
          <div className="flex flex-col items-center text-center gap-6 max-w-md">
            <img src="/images/lookout-icon.png" alt="Lookout" className="w-16 h-16 rounded-2xl" />
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold">Opening Lookout</h1>
              <p className="text-muted">
                The Lookout app should have opened on your desktop. If nothing happened, you may need to install it first.
              </p>
            </div>
            <div className="flex flex-col gap-3 w-full">
              <a
                href="https://lookout.hackclub.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-red hover:bg-red/90 text-white font-bold py-3 px-6 rounded-lg transition-colors text-center"
              >
                Get Lookout
              </a>
              <button
                onClick={() => setDesktopLaunched(false)}
                className="w-full border border-slate hover:bg-darkless font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
              >
                Go back
              </button>
            </div>
          </div>
        </div>
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

  if (captureMode && config) {
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
          draftId={config.draftId}
          onShareFailed={() => { releasePendingStream(); setCaptureMode(null); setCameraDeviceId(null); }}
          onBrowserError={(message) => {
            // Browser capture failed — return to the selector (the "picker") and remember why,
            // so we can warn the user and steer them toward Desktop. Pre-select Desktop so the
            // Browser tile reads as dimmed/de-emphasized (we don't launch anything).
            releasePendingStream();
            setCaptureMode(null);
            setCameraDeviceId(null);
            setBrowserError(message);
            setSelectedMode("desktop");
          }}
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
            {browserError && (
              <div className="flex items-start gap-3 text-sm bg-red/10 border border-red/30 text-red rounded-lg p-3">
                <Icon glyph="important" size={20} className="shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1 leading-relaxed">
                  <span>
                    Hey! Your browser didn&apos;t properly capture your screen, so recording couldn&apos;t start. We recommend using Desktop instead.
                  </span>
                  <span className="text-red/70 text-xs">Reason: {browserError}</span>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 w-full">
              <RecordingModeOption
                icon="laptop"
                title="Desktop"
                description="Open in Lookout app"
                selected={selectedMode === "desktop"}
                onClick={() => { setSelectedMode("desktop"); setConfirmingBrowser(false); }}
                recommended
              />
              <RecordingModeOption
                icon="web"
                title="Browser"
                description="Share your screen"
                selected={selectedMode === "screen"}
                dimmed={!!browserError}
                onClick={() => { setSelectedMode("screen"); setConfirmingBrowser(false); }}
              />
              <RecordingModeOption
                icon="camera"
                title="Camera"
                description="Use your webcam"
                selected={selectedMode === "camera"}
                onClick={() => { setSelectedMode("camera"); setConfirmingBrowser(false); }}
              />
            </div>

            {confirmingBrowser ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-center text-muted">
                  Are you sure? This didn&apos;t work last time!
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setSelectedMode("desktop"); setConfirmingBrowser(false); }}
                    className="flex-1 bg-red hover:bg-red/90 text-white font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
                  >
                    Use Desktop
                  </button>
                  <button
                    onClick={handleStart}
                    disabled={isCreating}
                    className="flex-1 border border-slate hover:bg-darkless font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCreating ? "Setting up..." : "Try Browser anyway"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleStart}
                disabled={isCreating}
                className="w-full bg-red hover:bg-red/90 text-white font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? "Setting up..." : selectedMode === "desktop" ? "Open Lookout" : "Start Recording"}
              </button>
            )}
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

// The browser screen picker reports a deliberate user cancellation with this exact
// message (from getDisplayMedia's AbortError, mapped in the Lookout SDK). We treat
// it as "go back to mode selection" rather than a scary error — see the error effect.
const SCREEN_CANCELLED_MESSAGE = "Screen sharing was cancelled.";

function LapseRecorder({ draftId, onShareFailed, onBrowserError }: {
  draftId: string;
  onShareFailed: () => void;
  onBrowserError: (message: string) => void;
}) {
  const router = useRouter();
  const { state, actions } = useLookout();
  const [error, setError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const screenStarted = useRef(false);
  const isCamera = state.captureMode === "camera";

  // Camera: auto-start preview (mirrors Fallout's BrowserRecorderUI)
  useEffect(() => {
    if (isCamera && !state.isPreviewing && !state.isSharing) {
      actions.startPreview().catch((err) =>
        setCaptureError(err instanceof Error ? err.message : "Could not start your camera.")
      );
    }
  }, [isCamera, state.status, state.isPreviewing, state.isSharing]);

  // Screen: auto-start sharing on mount. The screen stream was already
  // requested from the click gesture (see primeScreenShare) and a one-shot
  // getDisplayMedia shim hands it to the SDK here, satisfying Safari's
  // gesture requirement even though this runs from an effect.
  useEffect(() => {
    if (isCamera) return;
    if (screenStarted.current) return;
    screenStarted.current = true;
    actions.startSharing();
  }, [isCamera, actions]);

  // Surface capture errors to the user instead of silently restarting the flow.
  //
  // `state.error` is set by the Lookout SDK both when screen sharing fails to start
  // *after* the user picked a source (e.g. the OS never hands us a stream — common on
  // Linux) and when the initial session load fails. Previously any such error silently
  // bounced the user back to mode selection, which read as "selecting a source restarts
  // the whole flow". Now we show a clear message. The one exception is a deliberate
  // cancellation of the OS screen picker, which should just quietly return to selection.
  useEffect(() => {
    if (!state.error) return;
    if (!isCamera) {
      // Screen capture failed. A deliberate cancel of the OS picker just returns to the
      // selector with no fuss; anything else is a real failure, which we hand back to the
      // selector (the "picker") along with the reason so it can warn and steer to Desktop.
      if (state.error === SCREEN_CANCELLED_MESSAGE) {
        onShareFailed();
      } else {
        onBrowserError(state.error);
      }
      return;
    }
    setCaptureError(state.error);
  }, [isCamera, state.error, onShareFailed, onBrowserError]);

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
      router.push(`/timelapse/publish/${draftId}`);
    }
  }, [state.status, draftId, router]);

  function handleStartSharing() {
    actions.startSharing().catch((err) =>
      setCaptureError(err instanceof Error ? err.message : "Could not start recording.")
    );
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop recording");
    }
  }

  // Camera failures show an inline modal; screen failures are handled by the effect above,
  // which sends the user back to the selector with the error recorded.
  if (captureError) {
    return (
      <RootLayout showHeader={false}>
        <ErrorModal
          isOpen
          setIsOpen={() => {}}
          title="Couldn't start your camera"
          message={`${captureError} Please check your browser's camera permissions and try again.`}
          onClose={onShareFailed}
          buttons={[
            { label: "Try again", onClick: onShareFailed, kind: "primary" },
          ]}
        />
      </RootLayout>
    );
  }

  // Screen mode: hide recording UI while the browser's screen picker is open
  if (!isCamera && !state.isSharing && !state.error) {
    return <RootLayout showHeader={false}><div /></RootLayout>;
  }

  // Camera preview phase — show preview and "Start Recording" button
  if (isCamera && state.isPreviewing && !state.isSharing) {
    const formattedTime = formatTrackedTime(state.displaySeconds);
    return (
      <RootLayout showHeader={false}>
        <div className="flex w-screen h-screen bg-dark p-8 relative">
          <TimePill formattedTime={formattedTime} isRecording={false} displaySeconds={state.displaySeconds} />

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
        <TimePill formattedTime={formattedTime} isRecording={state.isRecording} displaySeconds={state.displaySeconds} />

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
