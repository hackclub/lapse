import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";

import { formatDuration, formatDurationLong } from "@/components/Duration";

const PLAYBACK_RATES = [0.5, 1, 1.5, 2, 4];
const SKIP_SECONDS = 5;
const LONG_SKIP_SECONDS = 10;

/** A frame step, in seconds. Timelapses are encoded at a fixed rate, so a fixed guess is close enough to step by. */
const FRAME_SECONDS = 1 / 30;

/** How long the pointer has to sit still before the controls get out of the way of the video. */
const CONTROLS_IDLE_MS = 2500;

function clamp(x: number, min: number, max: number) {
  return Math.min(Math.max(x, min), max);
}

/**
 * A transcoded timelapse doesn't always carry a usable duration in its metadata - a stream that was remuxed rather
 * than re-encoded can report `Infinity` until it has been fully buffered. The seekable range is what the player can
 * actually reach, so it's the better answer whenever the metadata doesn't have one.
 */
function readDuration(video: HTMLVideoElement): number {
  if (Number.isFinite(video.duration) && video.duration > 0)
    return video.duration;

  if (video.seekable.length > 0) {
    const end = video.seekable.end(video.seekable.length - 1);
    if (Number.isFinite(end) && end > 0)
      return end;
  }

  return 0;
}

/** The end of the buffered range the playhead is currently sitting in - i.e. how far ahead playback can run. */
function readBufferedEnd(video: HTMLVideoElement): number {
  const time = video.currentTime;

  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= time + 0.05 && video.buffered.end(i) >= time)
      return video.buffered.end(i);
  }

  return 0;
}

export function TimelapsePlayer({ src, poster, realDuration = 0, keyboardShortcuts = true, className }: {
  src: string;
  poster?: string;

  /**
   * The real amount of time the timelapse covers, in seconds. Shown while scrubbing, so that a position in the video
   * can be read as a position in the session it was recorded from.
   */
  realDuration?: number;

  /** Set to `false` while something else on the page (a modal, say) should be getting the key presses instead. */
  keyboardShortcuts?: boolean;

  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rate, setRate] = useState(1);
  const [controlsAwake, setControlsAwake] = useState(true);

  // The controls only ever hide themselves out of the way of a video that is actually playing - a paused player with
  // no controls is just a still image nobody can do anything with.
  const controlsShown = !isPlaying || isScrubbing || controlsAwake;

  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wakeControls = useCallback(() => {
    setControlsAwake(true);

    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
    }

    idleTimer.current = setTimeout(() => setControlsAwake(false), CONTROLS_IDLE_MS);
  }, []);

  useEffect(() => () => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
    }
  }, []);

  /*
    `timeupdate` only fires about four times a second, which is enough for a readout and nowhere near enough for a
    playhead that's meant to look like it's moving. While playback is running we drive the position off the frame
    clock instead, and let the events handle everything that happens in between.
  */
  useEffect(() => {
    if (!isPlaying)
      return;

    let frame = 0;

    const tick = () => {
      const video = videoRef.current;
      if (video) {
        setCurrentTime(video.currentTime);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying]);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video)
      return;

    const total = readDuration(video);
    const target = clamp(time, 0, total || 0);

    video.currentTime = target;
    setCurrentTime(target);
    setHasEnded(false);
    wakeControls();
  }, [wakeControls]);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video)
      return;

    seekTo(video.currentTime + delta);
  }, [seekTo]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video)
      return;

    if (video.paused) {
      // Hitting play on a finished video should replay it, not sit there at the end doing nothing.
      const total = readDuration(video);
      if (video.ended || (total > 0 && video.currentTime >= total - 0.05)) {
        video.currentTime = 0;
      }

      video.play().catch(() => {});
    }
    else {
      video.pause();
    }

    wakeControls();
  }, [wakeControls]);

  const setPlaybackRate = useCallback((next: number) => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = next;
    }

    setRate(next);
    wakeControls();
  }, [wakeControls]);

  const stepRate = useCallback((direction: 1 | -1) => {
    const index = PLAYBACK_RATES.indexOf(rate);
    setPlaybackRate(PLAYBACK_RATES[clamp((index < 0 ? 1 : index) + direction, 0, PLAYBACK_RATES.length - 1)]);
  }, [rate, setPlaybackRate]);

  const cycleRate = useCallback(() => {
    const index = PLAYBACK_RATES.indexOf(rate);
    setPlaybackRate(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]);
  }, [rate, setPlaybackRate]);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container)
      return;

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    else {
      container.requestFullscreen().catch(() => {});
    }

    wakeControls();
  }, [wakeControls]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);

    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!keyboardShortcuts)
      return;

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey)
        return;

      // Anything the user is typing into belongs to whatever they're typing into - the comment composer is right
      // below the player, and a space there is a space.
      const target = ev.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)))
        return;

      switch (ev.key) {
        case " ":
        case "k":
          togglePlay();
          break;
        case "ArrowLeft":
          seekBy(-SKIP_SECONDS);
          break;
        case "ArrowRight":
          seekBy(SKIP_SECONDS);
          break;
        case "j":
          seekBy(-LONG_SKIP_SECONDS);
          break;
        case "l":
          seekBy(LONG_SKIP_SECONDS);
          break;
        case ",":
          videoRef.current?.pause();
          seekBy(-FRAME_SECONDS);
          break;
        case ".":
          videoRef.current?.pause();
          seekBy(FRAME_SECONDS);
          break;
        case "<":
          stepRate(-1);
          break;
        case ">":
          stepRate(1);
          break;
        case "Home":
          seekTo(0);
          break;
        case "End":
          seekTo(duration);
          break;
        case "f":
          toggleFullscreen();
          break;
        case "Escape":
          // The browser takes care of leaving fullscreen; we just don't want to swallow it.
          return;
        default:
          if (/^[0-9]$/.test(ev.key)) {
            seekTo((Number(ev.key) / 10) * duration);
            break;
          }

          return;
      }

      ev.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardShortcuts, togglePlay, seekBy, seekTo, stepRate, toggleFullscreen, duration]);

  const syncFromVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video)
      return;

    setDuration(readDuration(video));
    setBufferedEnd(readBufferedEnd(video));
  }, []);

  const wasPlayingBeforeScrub = useRef(false);

  const onScrubStart = useCallback(() => {
    const video = videoRef.current;
    if (!video)
      return;

    wasPlayingBeforeScrub.current = !video.paused;
    video.pause();
    setIsScrubbing(true);
  }, []);

  const onScrub = useCallback((ratio: number) => {
    const video = videoRef.current;
    if (!video)
      return;

    const total = readDuration(video);
    if (total <= 0)
      return;

    const target = ratio * total;
    video.currentTime = target;
    setCurrentTime(target);
    setHasEnded(false);
  }, []);

  const onScrubEnd = useCallback(() => {
    setIsScrubbing(false);

    if (wasPlayingBeforeScrub.current) {
      videoRef.current?.play().catch(() => {});
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={clsx(
        "relative bg-[#000] overflow-hidden select-none",
        isFullscreen ? "w-screen h-screen" : "aspect-video w-full",
        !controlsShown && "cursor-none",
        !isFullscreen && className
      )}
      onPointerMove={wakeControls}
      onPointerDown={wakeControls}
      onPointerLeave={() => isPlaying && setControlsAwake(false)}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        className="w-full h-full object-contain"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={syncFromVideo}
        onDurationChange={syncFromVideo}
        onProgress={syncFromVideo}
        onPlay={() => { setIsPlaying(true); setHasStarted(true); setHasEnded(false); }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { setIsPlaying(false); setHasEnded(true); }}
        onWaiting={() => setIsWaiting(true)}
        onPlaying={() => setIsWaiting(false)}
        onCanPlay={() => setIsWaiting(false)}
        onTimeUpdate={ev => {
          if (!isScrubbing) {
            setCurrentTime(ev.currentTarget.currentTime);
          }

          setBufferedEnd(readBufferedEnd(ev.currentTarget));
        }}
        onSeeked={() => setIsWaiting(false)}
      />

      { isWaiting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-white animate-spin" />
        </div>
      ) }

      {/* The one big target for "just play the thing", before anything else has been asked of the viewer. */}
      { (!hasStarted || hasEnded) && !isWaiting && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#000]/20 pointer-events-none">
          <button
            type="button"
            aria-label={hasEnded ? "Replay" : "Play"}
            onClick={togglePlay}
            className={clsx(
              "flex items-center justify-center w-20 h-20 rounded-full bg-red text-white shadow-elevated pointer-events-auto",
              "cursor-pointer transition-transform hover:scale-110 active:scale-95"
            )}
          >
            { hasEnded
              ? <Icon glyph="view-reload" size={40} />
              : <PlayGlyph className="w-9 h-9" /> }
          </button>
        </div>
      ) }

      {/* Sits above the video but doesn't take its clicks - only the controls themselves do. */}
      <div
        className={clsx(
          "absolute inset-x-0 bottom-0 pointer-events-none",
          // Real black, not the palette's `black` (#1f2d3d) - a scrim in that colour fades the video out to grey.
          "bg-gradient-to-t from-[#000]/85 via-[#000]/45 to-[#000]/0 pt-16",
          "transition-opacity duration-200",
          controlsShown ? "opacity-100" : "opacity-0"
        )}
      >
        <div className={clsx(
          "flex flex-col gap-1 px-3 pb-2 sm:px-4 sm:pb-3",
          // Controls that have faded out mustn't keep swallowing clicks meant for the video underneath them.
          controlsShown ? "pointer-events-auto" : "pointer-events-none"
        )}>
          <Scrubber
            duration={duration}
            currentTime={currentTime}
            bufferedEnd={bufferedEnd}
            realDuration={realDuration}
            disabled={!controlsShown}
            onScrubStart={onScrubStart}
            onScrub={onScrub}
            onScrubEnd={onScrubEnd}
          />

          <div className="flex items-center gap-1 sm:gap-2 text-white">
            <ControlButton label={isPlaying ? "Pause (k)" : "Play (k)"} onClick={togglePlay}>
              { isPlaying ? <PauseGlyph className="w-6 h-6" /> : <PlayGlyph className="w-6 h-6" /> }
            </ControlButton>

            <ControlButton label={`Back ${SKIP_SECONDS}s (←)`} onClick={() => seekBy(-SKIP_SECONDS)} className="hidden sm:flex">
              <SkipGlyph className="w-5 h-5 scale-x-[-1]" />
            </ControlButton>

            <ControlButton label={`Forward ${SKIP_SECONDS}s (→)`} onClick={() => seekBy(SKIP_SECONDS)} className="hidden sm:flex">
              <SkipGlyph className="w-5 h-5" />
            </ControlButton>

            <div className="ml-1 sm:ml-2 font-mono text-sm tabular-nums text-white">
              {formatDuration(currentTime)}
              <span className="text-white/50"> / {formatDuration(duration)}</span>
            </div>

            <div className="flex-1" />

            <ControlButton
              label="Playback speed (< and >)"
              onClick={cycleRate}
              className="font-mono text-sm font-bold"
            >
              {rate}&times;
            </ControlButton>

            <ControlButton label={isFullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"} onClick={toggleFullscreen}>
              <Icon glyph={isFullscreen ? "fullscreen-exit" : "fullscreen"} size={24} />
            </ControlButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Scrubber({ duration, currentTime, bufferedEnd, realDuration, disabled, onScrubStart, onScrub, onScrubEnd }: {
  duration: number;
  currentTime: number;
  bufferedEnd: number;
  realDuration: number;
  disabled: boolean;
  onScrubStart: () => void;
  onScrub: (ratio: number) => void;
  onScrubEnd: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const playedRatio = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const bufferedRatio = duration > 0 ? clamp(bufferedEnd / duration, 0, 1) : 0;
  const expanded = isDragging || hoverRatio !== null;

  const ratioAt = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0)
      return 0;

    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }, []);

  const endDrag = useCallback(() => {
    setIsDragging(false);
    onScrubEnd();
  }, [onScrubEnd]);

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={formatDuration(currentTime)}
      className={clsx(
        "relative flex items-center h-5 touch-none",
        disabled ? "pointer-events-none" : "cursor-pointer"
      )}
      onPointerDown={ev => {
        if (ev.button !== 0 || duration <= 0)
          return;

        ev.preventDefault();
        ev.currentTarget.setPointerCapture(ev.pointerId);

        setIsDragging(true);
        setHoverRatio(ratioAt(ev.clientX));
        onScrubStart();
        onScrub(ratioAt(ev.clientX));
      }}
      onPointerMove={ev => {
        const ratio = ratioAt(ev.clientX);
        setHoverRatio(ratio);

        if (isDragging) {
          onScrub(ratio);
        }
      }}
      onPointerUp={ev => {
        if (!isDragging)
          return;

        ev.currentTarget.releasePointerCapture(ev.pointerId);
        endDrag();

        // A finger leaves no cursor behind, so nothing would ever clear the preview it left hovering.
        if (ev.pointerType !== "mouse") {
          setHoverRatio(null);
        }
      }}
      onLostPointerCapture={() => isDragging && endDrag()}
      onPointerLeave={() => !isDragging && setHoverRatio(null)}
    >
      <div
        ref={trackRef}
        className={clsx(
          "relative w-full rounded-full bg-white/25 transition-[height] duration-150",
          expanded ? "h-2" : "h-1.5"
        )}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/30"
          style={{ width: `${bufferedRatio * 100}%` }}
        />

        <div
          className="absolute inset-y-0 left-0 rounded-full bg-red"
          style={{ width: `${playedRatio * 100}%` }}
        />

        <div
          className={clsx(
            "absolute top-1/2 w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red shadow-card",
            "transition-transform duration-150",
            expanded ? "scale-100" : "scale-0"
          )}
          style={{ left: `${playedRatio * 100}%` }}
        />
      </div>

      { hoverRatio !== null && duration > 0 && (
        <div
          className="absolute bottom-full mb-3 -translate-x-1/2 pointer-events-none"
          style={{ left: `${clamp(hoverRatio, 0.04, 0.96) * 100}%` }}
        >
          <div className="flex flex-col items-center rounded-lg border border-black bg-darker/95 px-2.5 py-1.5 shadow-elevated">
            <span className="font-mono text-sm tabular-nums text-white">
              {formatDuration(hoverRatio * duration)}
            </span>

            { realDuration > 0 && (
              <span className="text-xs text-secondary text-nowrap">
                {formatDurationLong(hoverRatio * realDuration)} in
              </span>
            ) }
          </div>
        </div>
      ) }
    </div>
  );
}

function ControlButton({ children, label, onClick, className }: React.PropsWithChildren<{
  label: string;
  onClick: () => void;
  className?: string;
}>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        "flex items-center justify-center min-w-9 h-9 px-1 rounded-lg text-white/90 shrink-0",
        "cursor-pointer transition-all hover:text-white hover:scale-110 active:scale-95",
        className
      )}
    >
      {children}
    </button>
  );
}

/*
  A triangle looks centred when its centroid is in the middle, not when its bounding box is - the corner nearest the
  tip is nearly empty, so a box-centred one reads as sitting too far right. These points put the centroid exactly on
  (12, 12): for vertices at x = a, a, b, that means 2a + b = 36. The stroke is what rounds the corners off, and since
  it grows the shape evenly on all sides it leaves the centroid where it is.
*/
function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M8.5 5.5 19 12 8.5 18.5Z" />
    </svg>
  );
}

function PauseGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <rect x="6" y="4.5" width="4" height="15" rx="1.25" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.25" />
    </svg>
  );
}

function SkipGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M2.5 6.4v11.2a1 1 0 0 0 1.55.83l8.4-5.6a1 1 0 0 0 0-1.66l-8.4-5.6a1 1 0 0 0-1.55.83Z" />
      <path d="M12 6.4v11.2a1 1 0 0 0 1.55.83l8.4-5.6a1 1 0 0 0 0-1.66l-8.4-5.6A1 1 0 0 0 12 6.4Z" />
    </svg>
  );
}
