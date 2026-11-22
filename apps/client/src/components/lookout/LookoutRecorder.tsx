import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import { LookoutProvider, useLookout } from "@lookout/react";
import type { CaptureMode } from "@lookout/react";
import type { BrowserLabelVariant, RecordingMode } from "@hackclub/lapse-api";

import type { IconGlyph } from "@/common";
import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { useHackatimeLinkStatus } from "@/hooks/useHackatimeRelink";
import { useInterval } from "@/hooks/useInterval";
import { useRecordingKeepAwake } from "@/hooks/useRecordingKeepAwake";
import { checkBrowserRecorderSupport } from "@/components/lookout/engineSupport";
import { storeSession } from "@/components/lookout/sessions";
import RootLayout from "@/components/layout/RootLayout";
import { EditorModal } from "@/components/lookout/EditorModal";
import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { CopyField } from "@/components/ui/CopyField";
import { PillControlButton } from "@/components/ui/PillControlButton";

/** The deep link that hands a recording session to the Lookout desktop app. */
function desktopSessionLink(token: string): string {
  return `lookout://session?token=${token}`;
}

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
import { Morph } from "@/components/ui/Morph";

interface LookoutSessionConfig {
  draftId: string;
  lookoutToken: string;
  lookoutApiBaseUrl: string;
  lookoutSessionId: string;
}

const BROWSER_LABELS: Record<BrowserLabelVariant, { badge?: string; note?: string }> = {
  "none": {},
  "badge-less-stable": { badge: "Less stable" },
  "badge-legacy": { badge: "Legacy" },
  "text-less-stable": { note: "Less stable" },
  "text-legacy": { note: "Legacy" },
};

function RecordingModeOption({ icon, title, description, selected, onClick, recommended, badge, note, dimmed, unavailable }: {
  icon: IconGlyph;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  recommended?: boolean;
  /** A muted badge in the same spot as "Recommended". */
  badge?: string;
  /** Small muted text under the description. */
  note?: string;
  dimmed?: boolean;
  /** Greyed out for good. Still clickable, so the click can explain why. */
  unavailable?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-disabled={unavailable || undefined}
      className={clsx(
        "relative flex flex-col items-center gap-3 p-6 w-full transition-colors rounded-lg border",
        unavailable ? "border-slate opacity-40 grayscale cursor-not-allowed"
          : selected ? "bg-red text-white border-red cursor-pointer"
          : "border-slate hover:bg-darkless cursor-pointer",
        dimmed && !selected && !unavailable && "opacity-40"
      )}
    >
      {recommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-red text-white text-xs font-bold px-3 py-0.5 rounded-full uppercase tracking-wide">
          Recommended
        </span>
      )}
      {!recommended && badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-darkless border border-slate text-muted text-xs font-bold px-3 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
          {badge}
        </span>
      )}
      <Icon glyph={icon} size={48} className="shrink-0" />
      <div className="flex flex-col items-center text-center gap-1">
        <span className="font-bold text-lg">{title}</span>
        <span className={clsx("text-sm", selected ? "text-white/80" : "text-muted")}>{description}</span>
        {note && (
          <span className={clsx("text-xs italic", selected ? "text-white/60" : "text-muted/70")}>({note})</span>
        )}
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
        <Morph>{formattedTime}</Morph>
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
        });
      }
      catch (err) {
        // Android often refuses to reopen a camera that was just released (NotReadableError). The
        // preview is only a convenience, so say so in its place rather than leaving an unhandled rejection.
        if (!cancelled) setError(describeCameraError(err));
        return;
      }
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

  if (error)
    return <p className="w-full aspect-video rounded-lg bg-darker flex items-center justify-center p-4 text-center text-sm text-muted">{error}</p>;

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
  // The engine's live preview frames are only 854x480, which looks soft blown up to fill the
  // screen. Every upload tick also hands us the full-resolution frame, so that's what we show.
  const [fullCaptureUrl, setFullCaptureUrl] = useState<string | null>(null);
  const [pickingCamera, setPickingCamera] = useState(false);
  const [desktopLaunched, setDesktopLaunched] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [phase, setPhase] = useState<"checking" | "ready">("checking");
  const hackatimeStatus = useHackatimeLinkStatus();
  // Set when a previous Browser (screen) capture failed. Drives the warning blurb,
  // the dimmed Browser option, and the "are you sure?" confirmation on the selector.
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [confirmingBrowser, setConfirmingBrowser] = useState(false);
  // Set when this browser can't load Lookout's WebAssembly recorder, which both Browser and Camera
  // modes run on. Checked up front so nobody finds out after they've already shared their screen.
  const [engineError, setEngineError] = useState<string | null>(null);
  // Users banned on Hackatime have to record with the desktop app.
  const screenModeBlocked = hackatimeStatus === "restricted";
  const [browserLabelVariant, setBrowserLabelVariant] = useState<BrowserLabelVariant | null>(null);
  const [browserLabelSettled, setBrowserLabelSettled] = useState(false);
  const browserLabelRequested = useRef(false);
  const [showScreenBlockedNotice, setShowScreenBlockedNotice] = useState(false);
  // Browser (screen) mode can be put under maintenance by the server.
  const [browserRecordingAvailable, setBrowserRecordingAvailable] = useState(true);
  const [showMaintenanceNotice, setShowMaintenanceNotice] = useState(false);
  const initialized = useRef(false);
  // Cleanup for an in-gesture screen-share primed by primeScreenShare(): stops
  // the stream and restores getDisplayMedia if the SDK never consumed it.
  const primeCleanupRef = useRef<(() => void) | null>(null);

  const releasePendingStream = useCallback(() => {
    primeCleanupRef.current?.();
    primeCleanupRef.current = null;
  }, []);

  // Each new capture replaces the last, so free the old frame's memory as soon as it's off screen.
  useEffect(() => {
    if (!fullCaptureUrl)
      return;

    return () => URL.revokeObjectURL(fullCaptureUrl);
  }, [fullCaptureUrl]);

  useEffect(() => {
    if (initialized.current) return;
    if (!router.isReady) return;
    if (auth.isLoading || !auth.currentUser) return;
    initialized.current = true;
    setPhase("ready");
  }, [router.isReady, auth.isLoading, auth.currentUser]);

  // The picker waits for this, so the Browser tile never changes under the user.
  useEffect(() => {
    if (!auth.currentUser || browserLabelRequested.current)
      return;

    browserLabelRequested.current = true;
    // Never hold up recording for an experiment: past this, show the picker unlabelled.
    setTimeout(() => setBrowserLabelSettled(true), 1500);
    api.timelapse.assignBrowserLabelVariant({})
      .then(res => {
        if (res.ok)
          setBrowserLabelVariant(res.data.variant);
      })
      .catch(() => {})
      .finally(() => setBrowserLabelSettled(true));
  }, [auth.currentUser]);

  useEffect(() => {
    if (phase !== "ready" || !auth.currentUser)
      return;

    let cancelled = false;
    api.timelapse.getRecordingAvailability({})
      .then(res => {
        if (!cancelled && res.ok)
          setBrowserRecordingAvailable(res.data.browser);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [phase, auth.currentUser]);

  useEffect(() => {
    let cancelled = false;
    checkBrowserRecorderSupport().then((reason) => {
      if (!cancelled) setEngineError(reason);
    });
    return () => { cancelled = true; };
  }, []);

  async function createSessionAndStart(mode: RecordingMode, onReady: (cfg: LookoutSessionConfig) => void) {
    setIsCreating(true);
    try {
      const res = await api.timelapse.createRecordingSession({ mode });
      if (!res.ok && res.error === "UNAVAILABLE") {
        releasePendingStream();
        setBrowserRecordingAvailable(false);
        setSelectedMode("desktop");
        setShowMaintenanceNotice(true);
        return;
      }
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

  useEffect(() => {
    if (screenModeBlocked && selectedMode === "screen")
      setSelectedMode("desktop");
  }, [screenModeBlocked, selectedMode]);

  function handleStart() {
    if (selectedMode === "screen" && screenModeBlocked) {
      setShowScreenBlockedNotice(true);
      return;
    }

    if (selectedMode === "screen" && !browserRecordingAvailable) {
      setShowMaintenanceNotice(true);
      return;
    }

    // If Browser failed last time (or the in-browser recorder couldn't load), make the user actively
    // confirm before trying it anyway.
    const browserRecordingDoubtful = (selectedMode === "screen" && !!browserError)
      || (selectedMode !== "desktop" && !!engineError);
    if (browserRecordingDoubtful && !confirmingBrowser) {
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

    createSessionAndStart(selectedMode, startWithConfig);
  }

  function startWithConfig(cfg: LookoutSessionConfig) {
    if (selectedMode === "desktop") {
      window.location.href = desktopSessionLink(cfg.lookoutToken);
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
      createSessionAndStart("camera", () => setCaptureMode("camera"));
    }
  }

  if (phase === "checking" || (phase === "ready" && !browserLabelSettled)) {
    return (
      <RootLayout showHeader={false}>
        <div className="flex items-center justify-center h-app text-muted">Loading...</div>
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
    const sessionLink = desktopSessionLink(config.lookoutToken);

    return (
      <RootLayout showHeader={false}>
        <div className="min-h-app flex items-center justify-center px-4 py-12">
          <div className="flex flex-col items-center text-center gap-6 max-w-md">
            <img src="/images/lookout-icon.png" alt="Lookout" className="w-16 h-16 rounded-2xl" />
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold">Opening Lookout</h1>
              <p className="text-muted">
                The Lookout desktop app should open automatically — if it has&apos;t yet, you made need to install it. We&apos;ll bring you back here to publish your timelapse once you&apos;ve finished recording.
              </p>
            </div>
            <div className="flex flex-col gap-3 w-full">
              {/* Installing is the way out of this screen for most people who end up reading it, so it leads. */}
              <a
                href="https://lookout.hackclub.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-red hover:bg-red/90 text-white font-bold py-3 px-6 rounded-lg transition-colors text-center"
              >
                Get Lookout
              </a>

              <div className="flex items-center gap-3 w-full">
                <button
                  onClick={() => setDesktopLaunched(false)}
                  title="Go back"
                  aria-label="Go back"
                  className="shrink-0 flex items-center justify-center w-12 h-12 border border-slate hover:bg-darkless rounded-lg transition-colors cursor-pointer"
                >
                  <Icon glyph="back" size={24} />
                </button>
                <a
                  href={sessionLink}
                  className="flex-1 border border-slate hover:bg-darkless font-bold py-3 px-6 rounded-lg transition-colors text-center"
                >
                  Open Lookout again
                </a>
              </div>
            </div>

            {/*
              The deep link, in the flesh. Lookout has a "paste a lookout:// link" box precisely for when the
              handoff doesn't fire on its own (a browser that swallows unknown schemes, a fresh install that
              hasn't registered one yet), and this is the only place the link exists to be copied from.
            */}
            <div className="flex flex-col gap-2 w-full pt-4 border-t border-slate">
              <p className="text-sm text-muted">
                Still nothing? Copy this link and paste it into Lookout.
              </p>
              <CopyField value={sessionLink} label="Recording session link" />
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
        callbacks={{ onCapture: (capture) => setFullCaptureUrl(URL.createObjectURL(capture.blob)) }}
        capture={captureMode === "camera"
          ? { mode: "camera", camera: cameraDeviceId ? { deviceId: cameraDeviceId } : undefined }
          : undefined
        }
      >
        <LapseRecorder
          draftId={config.draftId}
          lookoutToken={config.lookoutToken}
          apiBaseUrl={config.lookoutApiBaseUrl}
          fullCaptureUrl={fullCaptureUrl}
          onShareFailed={() => { releasePendingStream(); setCaptureMode(null); setCameraDeviceId(null); setFullCaptureUrl(null); }}
          onBrowserError={(message) => {
            // Browser capture failed — return to the selector (the "picker") and remember why,
            // so we can warn the user and steer them toward Desktop. Pre-select Desktop so the
            // Browser tile reads as dimmed/de-emphasized (we don't launch anything).
            releasePendingStream();
            setCaptureMode(null);
            setCameraDeviceId(null);
            setFullCaptureUrl(null);
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
            {engineError && !browserError && (
              <div className="flex items-start gap-3 text-sm bg-red/10 border border-red/30 text-red rounded-lg p-3">
                <Icon glyph="important" size={20} className="shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1 leading-relaxed">
                  <span>
                    Hey! Your browser can&apos;t run Lookout&apos;s in-browser recorder, so Browser and Camera recording probably won&apos;t work here. We recommend using Desktop instead.
                  </span>
                  <span className="text-red/70 text-xs">Reason: {engineError}</span>
                </div>
              </div>
            )}

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
                onClick={() => { setSelectedMode("desktop"); setConfirmingBrowser(false); setShowScreenBlockedNotice(false); }}
                recommended
              />
              <RecordingModeOption
                icon="web"
                title="Browser"
                description="Share your screen"
                selected={selectedMode === "screen"}
                dimmed={!!browserError || !!engineError}
                unavailable={screenModeBlocked}
                onClick={() => {
                  if (screenModeBlocked) {
                    setShowScreenBlockedNotice(true);
                    return;
                  }
                  setSelectedMode("screen");
                  setConfirmingBrowser(false);
                }}
                {...(browserLabelVariant ? BROWSER_LABELS[browserLabelVariant] : {})}
              />
              <RecordingModeOption
                icon="camera"
                title="Camera"
                description="Use your webcam"
                selected={selectedMode === "camera"}
                dimmed={!!engineError}
                onClick={() => { setSelectedMode("camera"); setConfirmingBrowser(false); setShowScreenBlockedNotice(false); }}
              />
            </div>

            {showScreenBlockedNotice && (
              <div role="alert" className="flex items-start gap-3 text-sm bg-red/10 border border-red/30 text-red rounded-lg p-3">
                <Icon glyph="private" size={20} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  Your account type does not allow you to use this recording mode.
                </span>
              </div>
            )}

            {confirmingBrowser ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-center text-muted">
                  {selectedMode === "screen" && browserError
                    ? "Are you sure? This didn't work last time!"
                    : "Are you sure? Your browser couldn't load the recorder."}
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
                    {isCreating ? "Setting up..." : selectedMode === "camera" ? "Try Camera anyway" : "Try Browser anyway"}
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

      <Modal isOpen={showMaintenanceNotice} onClose={() => setShowMaintenanceNotice(false)}>
        <ModalHeader
          icon="settings"
          showCloseButton={true}
          onClose={() => setShowMaintenanceNotice(false)}
          title="Under maintenance"
          description="Browser recording is currently under maintenance."
          shortDescription="Browser recording unavailable"
        />
        <ModalContent>
          <div className="flex flex-col gap-6">
            <p className="text-muted leading-relaxed">
              Recording in the browser is temporarily unavailable. Please use the Lookout desktop app to record your timelapse instead.
            </p>
            <button
              onClick={() => {
                setSelectedMode("desktop");
                setConfirmingBrowser(false);
                setShowMaintenanceNotice(false);
              }}
              className="w-full bg-red hover:bg-red/90 text-white font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
            >
              Use Desktop
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

/**
 * The latest screen capture, scaled to fill the space between the controls without cropping.
 * Sized from the image's own aspect ratio rather than `object-contain`, so the rounded corners
 * sit on the picture and not on an invisible letterbox around it.
 */
function CapturePreviewImage({ src }: { src: string }) {
  const [aspect, setAspect] = useState<number | null>(null);

  return (
    <div className="w-full h-full px-32 flex justify-center items-center">
      <div className="w-full h-full flex justify-center items-center" style={{ containerType: "size" }}>
        <img
          src={src}
          alt="Latest capture"
          className="rounded-[48px]"
          onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          style={aspect
            ? { width: `min(100cqw, 100cqh * ${aspect})` }
            : { maxWidth: "100%", maxHeight: "100%" }
          }
        />
      </div>
    </div>
  );
}

// The browser screen picker reports a deliberate user cancellation with this exact
// message (from getDisplayMedia's AbortError, mapped in the Lookout SDK). We treat
// it as "go back to mode selection" rather than a scary error — see the error effect.
const SCREEN_CANCELLED_MESSAGE = "Screen sharing was cancelled.";

// Browsers' own getUserMedia/play() messages are written for developers ("The fetching process for
// the media resource was aborted by the user agent..."), so map the names we can act on.
function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : null;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Lapse doesn't have permission to use your camera. Allow camera access in your browser's site settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "We couldn't find a camera. Make sure one is connected, then try again.";
    case "NotReadableError":
      return "Your camera is being used by another app or tab. Close it there, then try again.";
    case "AbortError":
      return "Your browser interrupted the camera before it started. Try again - if it keeps happening, reload the page.";
    default:
      return `${err instanceof Error ? err.message : "Something went wrong."} Check your browser's camera permissions and try again.`;
  }
}

function LapseRecorder({ draftId, lookoutToken, apiBaseUrl, fullCaptureUrl, onShareFailed, onBrowserError }: {
  draftId: string;
  lookoutToken: string;
  apiBaseUrl: string;
  fullCaptureUrl: string | null;
  onShareFailed: () => void;
  onBrowserError: (message: string) => void;
}) {
  const router = useRouter();
  const { state, actions } = useLookout();
  const [error, setError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Once recording stops we offer the cut/edit step before handing off to the publish
  // page. `editorDone` flips when the user saves or dismisses the editor, which is what
  // actually releases them to publish.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDone, setEditorDone] = useState(false);
  const screenStarted = useRef(false);
  // Whether a screen share has ever been live in this recorder. Tells "the picker is still open"
  // apart from "the share ended mid-recording", which look identical in `state.isSharing`.
  const [hasShared, setHasShared] = useState(false);
  const isCamera = state.captureMode === "camera";

  useRecordingKeepAwake(state.isRecording);

  if (state.isSharing && !hasShared) setHasShared(true);

  // Camera: auto-start preview (mirrors Fallout's BrowserRecorderUI).
  //
  // `isPreviewing` only flips once the stream is playing, which can be seconds after the call while
  // the permission prompt is up. Without the in-flight guard, a `status` change in that window
  // starts a second preview, which stops the first stream's tracks under its pending `play()` -
  // Firefox rejects that with an AbortError the user sees as "couldn't start your camera".
  const previewStarting = useRef(false);
  useEffect(() => {
    if (!isCamera || state.isPreviewing || state.isSharing || previewStarting.current)
      return;

    previewStarting.current = true;
    actions.startPreview()
      .catch((err: unknown) => setCaptureError(describeCameraError(err)))
      .finally(() => { previewStarting.current = false; });
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

  useInterval(() => {
    if (state.isRecording) {
      // Best-effort presence ping: the next tick retries, so a network blip mustn't become an unhandled rejection.
      api.user.emitHeartbeat({}).catch((err) => console.warn("(LookoutRecorder) heartbeat failed", err));
    }
  }, 30 * 1000);

  useEffect(() => {
    const recordingEnded = state.status === "stopped" || state.status === "compiling" || state.status === "complete";
    if (!recordingEnded) return;

    // The user has finished with the editor (saved cuts or dismissed it) — hand off to
    // the existing publish page. Without a token to edit against, skip straight there so
    // the flow never gets stuck.
    if (editorDone || !lookoutToken) {
      router.push(`/timelapse/publish/${draftId}`);
    } else {
      setEditorOpen(true);
    }
  }, [state.status, editorDone, lookoutToken, draftId, router]);

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
      // `edit: true` asks the server to hold the session open for editing after stop
      // instead of compiling straight to `complete`. Without it the cut/edit step below
      // gets a `not_ready` session ("isn't available for editing").
      await actions.stop({ edit: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop recording");
    }
  }

  // After recording stops, the cut/edit step is offered in a Lapse-styled modal. This
  // must precede the capture-state branches below (once stopped, `state.isSharing` is
  // false, which would otherwise render the empty placeholder). Dismissing or saving
  // sets `editorDone`, which the effect above turns into the publish-page handoff — the
  // editor itself publishes the (possibly cut) session; we just continue Lapse's flow.
  if (editorOpen && lookoutToken) {
    return (
      <RootLayout showHeader={false}>
        <EditorModal
          token={lookoutToken}
          apiBaseUrl={apiBaseUrl}
          onDone={() => { setEditorOpen(false); setEditorDone(true); }}
        />
      </RootLayout>
    );
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
          message={captureError}
          onClose={onShareFailed}
          buttons={[
            { label: "Try again", onClick: onShareFailed, kind: "primary" },
          ]}
        />
      </RootLayout>
    );
  }

  // The share ended mid-recording - the browser's "Stop sharing" bar, or the OS dropping the capture
  // when the screen locked or the machine slept. The SDK has already paused the session (flushing the
  // partial minute), so nothing is lost; sharing again from this click resumes it.
  const recordingEnded = state.status === "stopped" || state.status === "compiling" || state.status === "complete";
  if (!isCamera && !state.isSharing && !state.error && hasShared && !recordingEnded) {
    return (
      <RootLayout showHeader={false}>
        <Modal isOpen>
          <ModalHeader
            icon="web"
            showCloseButton={false}
            title="Screen sharing stopped"
            description="Your recording is paused, and everything so far is saved."
            shortDescription="Recording paused"
          />
          <ModalContent>
            <div className="flex flex-col gap-6">
              <p className="text-sm text-muted leading-relaxed">
                This can happen when your computer goes to sleep, the screen locks, or sharing is stopped from the browser. Share your screen again to pick up where you left off.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={stopRecording}
                  className="flex-1 border border-slate hover:bg-darkless font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
                >
                  Stop recording
                </button>
                <button
                  onClick={handleStartSharing}
                  className="flex-1 bg-red hover:bg-red/90 text-white font-bold py-3 px-6 rounded-lg transition-colors cursor-pointer"
                >
                  Share screen &amp; resume
                </button>
              </div>
            </div>
          </ModalContent>
        </Modal>
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
        <div className="flex w-screen h-app bg-dark p-8 relative">
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
  const captureUrl = fullCaptureUrl ?? state.lastScreenshotUrl;

  return (
    <RootLayout showHeader={false}>
      <div className="flex w-screen h-app bg-dark p-8 relative">
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
          ) : captureUrl ? (
            <CapturePreviewImage src={captureUrl} />
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
