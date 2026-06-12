import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface CaptureSource {
  id: string;
  name: string;
  kind: string;
}

interface SetupViewProps {
  user: { displayName: string; handle: string } | null;
  onStart: (sourceId: string, sourceKind: string) => void;
  onLogout: () => void;
}

function cardClass(selected: boolean) {
  return `rounded-lg border text-left transition-all overflow-hidden ${
    selected
      ? "border-red bg-red/10"
      : "border-white/10 hover:border-white/20 bg-white/5"
  }`;
}

function CaptureSourceCard({
  source,
  selected,
  onClick,
}: {
  source: CaptureSource;
  selected: boolean;
  onClick: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    invoke("thumbnail_stream_start", {
      sourceId: source.id,
      sourceKind: source.kind,
      sourceName: source.name,
    });

    const unlisten = listen<{ source_id: string; data: string }>(
      "thumbnail:frame",
      (event) => {
        if (event.payload.source_id === source.id) {
          setThumbUrl(event.payload.data);
        }
      }
    );

    return () => {
      invoke("thumbnail_stream_stop", { sourceId: source.id });
      unlisten.then((f) => f());
    };
  }, [source.id, source.kind, source.name]);

  return (
    <button onClick={onClick} className={cardClass(selected)}>
      {thumbUrl ? (
        <div className="aspect-video bg-black/30 overflow-hidden">
          <img
            src={thumbUrl}
            alt={source.name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="aspect-video bg-white/5 flex items-center justify-center">
          <span className="text-xs text-muted">Loading...</span>
        </div>
      )}
      <div className="p-3">
        <div className="text-sm font-medium truncate">{source.name}</div>
      </div>
    </button>
  );
}

function CameraPreview({ source }: { source: CaptureSource }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let devices = await navigator.mediaDevices.enumerateDevices();
        let match = devices.find(
          (d) => d.kind === "videoinput" && d.label === source.name
        );

        if (!match) {
          const tempStream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
          tempStream.getTracks().forEach((t) => t.stop());
          if (cancelled) return;

          devices = await navigator.mediaDevices.enumerateDevices();
          match = devices.find(
            (d) => d.kind === "videoinput" && d.label === source.name
          );
        }

        if (cancelled) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: match ? { deviceId: { exact: match.deviceId } } : true,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [source.name]);

  if (error) {
    return (
      <div className="aspect-video rounded-lg bg-white/5 flex items-center justify-center">
        <span className="text-sm text-muted">Camera unavailable</span>
      </div>
    );
  }

  return (
    <div className="aspect-video rounded-lg bg-black/30 overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
    </div>
  );
}

export function SetupView({ user, onStart, onLogout }: SetupViewProps) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<CaptureSource | null>(
    null
  );
  const [sourceTab, setSourceTab] = useState<"Screen" | "Window" | "Camera">(
    "Screen"
  );
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const windowsFetched = useRef(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const screens = await invoke<CaptureSource[]>("enumerate_sources");
        setSources(screens);
      } catch {
        // Screen enumeration is native and shouldn't fail
      }
      setLoading(false);

      try {
        await invoke<string>("check_ffmpeg_available");
        setFfmpegError(null);
        const cameras = await invoke<CaptureSource[]>("enumerate_cameras");
        setSources((prev) => [...prev.filter((s) => s.kind !== "Camera"), ...cameras]);
      } catch (e) {
        setFfmpegError(
          typeof e === "string"
            ? e
            : "FFmpeg not found. Please install FFmpeg to use Lapse."
        );
      }
    })();
  }, []);

  useEffect(() => {
    if (sourceTab === "Window" && !windowsFetched.current) {
      windowsFetched.current = true;
      (async () => {
        try {
          const windows = await invoke<CaptureSource[]>("enumerate_windows_cmd");
          setSources((prev) => [
            ...prev.filter((s) => s.kind !== "Window"),
            ...windows,
          ]);
        } catch {
          // ignore
        }
      })();
    }
  }, [sourceTab]);

  useEffect(() => {
    return () => {
      invoke("thumbnail_stream_stop_all");
    };
  }, []);

  const filteredSources = sources.filter((s) => s.kind === sourceTab);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <h1 className="text-lg font-semibold">Lapse</h1>
        {user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">@{user.handle}</span>
            <button
              onClick={onLogout}
              className="text-xs text-muted hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        {ffmpegError ? (
          <div className="bg-red/10 border border-red/30 rounded-lg p-4 text-sm text-red">
            {ffmpegError}
          </div>
        ) : (
          <>
            {/* Source type tabs */}
            <div className="flex gap-1 mb-4 bg-white/5 rounded-lg p-1">
              {(["Screen", "Window", "Camera"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setSourceTab(tab);
                    setSelectedSource(null);
                  }}
                  className={`flex-1 py-1.5 text-sm rounded-md transition-colors ${
                    sourceTab === tab
                      ? "bg-white/10 text-white"
                      : "text-muted hover:text-white"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Sources grid */}
            {loading ? (
              <div className="text-center text-muted text-sm py-8">
                Loading sources...
              </div>
            ) : filteredSources.length === 0 ? (
              <div className="text-center text-muted text-sm py-8">
                No {sourceTab.toLowerCase()} sources found
              </div>
            ) : sourceTab === "Camera" ? (
              <div className="space-y-3">
                <div className="flex flex-col gap-1">
                  {filteredSources.map((source) => {
                    const isSelected =
                      selectedSource?.id === source.id &&
                      selectedSource?.kind === source.kind;
                    return (
                      <button
                        key={`${source.kind}-${source.id}`}
                        onClick={() => setSelectedSource(source)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          isSelected
                            ? "bg-red/10 border border-red text-white"
                            : "border border-transparent hover:bg-white/5 text-muted hover:text-white"
                        }`}
                      >
                        {source.name}
                      </button>
                    );
                  })}
                </div>
                {selectedSource?.kind === "Camera" && (
                  <CameraPreview
                    key={selectedSource.id}
                    source={selectedSource}
                  />
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredSources.map((source) => (
                  <CaptureSourceCard
                    key={`${source.kind}-${source.id}`}
                    source={source}
                    selected={
                      selectedSource?.id === source.id &&
                      selectedSource?.kind === source.kind
                    }
                    onClick={() => setSelectedSource(source)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <button
          onClick={() => {
            if (selectedSource) {
              onStart(selectedSource.id, selectedSource.kind);
            }
          }}
          disabled={!selectedSource}
          className="w-full py-2.5 bg-red text-white font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Start Recording
        </button>
      </div>
    </div>
  );
}
