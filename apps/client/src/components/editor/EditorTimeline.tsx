import { Button } from "@/components/ui/Button";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";
import { VideoPlayback } from "@/hooks/useVideoPlayback";
import { makeFilmstrip } from "@/video";
import { EditListEntry } from "@hackclub/lapse-api";
import { formatDuration } from "@hackclub/lapse-shared";
import clsx from "clsx";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@hackclub/icons";

import CutIcon from "@/assets/icons/cut.svg";
import PlayIcon from "@/assets/icons/play.svg";
import PauseIcon from "@/assets/icons/pause.svg";
import PlayheadIcon from "@/assets/playhead.svg";
import { EditorEditRegion } from "@/components/editor/EditorEditRegion";


const FILMSTRIP_COUNT = 90;


export function EditorTimeline({ sessions, editList, setEditList, playback, onSaveAndExit, onPublish }: {
  sessions: { url: string; duration: number }[],
  editList: EditListEntry[],
  setEditList: (x: EditListEntry[]) => void,
  playback: VideoPlayback,
  onSaveAndExit: () => void,
  onPublish: () => void,
}) {
  const { time, playing, totalTime, seekTo: setTime, togglePlayback, getCurrentTime, videoRef } = playback;
  const [filmstrip, setFilmstrip] = useState<string[]>([]);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [selectedEditRegionIdx, setSelectedIndex] = useState<number | null>(null);

  const timelineRef = React.useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const playingStemRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const playingRef = useRef(playing);
  const filmstripStaleToken = useRef(0);

  playingRef.current = playing;

  // Thumbnail regeneration - this usually happens just once, unless `sessions` updates for some reason.
  useAsyncEffect(async () => {
    const startedAt = Date.now();
    filmstripStaleToken.current = startedAt;

    const placeholder = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
    const generated: string[] = Array(FILMSTRIP_COUNT).fill(placeholder);

    for await (const part of makeFilmstrip(FILMSTRIP_COUNT, sessions)) {
      if (filmstripStaleToken.current != startedAt)
        return;

      generated[part.idx] = part.url;
      setFilmstrip([...generated]);
    }

    console.log(`(EditorTimeline.tsx) generated ${generated.length} filmstrip parts!`);
  }, [sessions]);

  useEffect(() => {
    let rafId: number;
    let catchScrollTarget: number | null = null;
    let catchScrollStart: number | null = null;
    let catchScrollStartTime: number | null = null;
    const CATCH_DURATION_MS = 100;

    function tick() {
      const container = timelineRef.current;
      const head = playheadRef.current;
      const stem = playingStemRef.current;
      if (!container || !head || !stem || totalTime <= 0)
        return;

      const currentTime = getCurrentTime();

      const percent = `${(currentTime / totalTime) * 100}%`;
      head.style.left = percent;
      stem.style.left = percent;
      if (rulerRef.current) {
        stem.style.top = `${rulerRef.current.offsetHeight}px`;
      }

      if (playingRef.current) {
        const playheadPx = (currentTime / totalTime) * container.scrollWidth;
        const viewLeft = container.scrollLeft;
        const viewRight = viewLeft + container.clientWidth;

        if (catchScrollTarget !== null && catchScrollStartTime !== null && catchScrollStart !== null) {
          const elapsed = performance.now() - catchScrollStartTime;
          const t = Math.min(elapsed / CATCH_DURATION_MS, 1);
          const eased = t * (2 - t);
          container.scrollLeft = catchScrollStart + (catchScrollTarget - catchScrollStart) * eased;

          if (t >= 1) {
            catchScrollTarget = null;
            catchScrollStart = null;
            catchScrollStartTime = null;
          }
        }
        else if (playheadPx < viewLeft || playheadPx > viewRight) {
          catchScrollStart = container.scrollLeft;
          catchScrollTarget = playheadPx - container.clientWidth * 0.15;
          catchScrollStartTime = performance.now();
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, time, totalTime, getCurrentTime]);

  function zoom(newFactor: number) {
    const container = timelineRef.current;
    if (!container) return;

    // Calculate playhead position on screen before zoom
    const playheadPxBefore = (time / totalTime) * container.scrollWidth;
    const playheadScreenX = playheadPxBefore - container.scrollLeft;

    setZoomFactor(newFactor);

    requestAnimationFrame(() => {
      // Calculate new playhead position after zoom
      const newScrollWidth = container.scrollWidth;
      const playheadPxAfter = (time / totalTime) * newScrollWidth;
      container.scrollLeft = playheadPxAfter - playheadScreenX;
    });
  }

  function zoomIn() {
    zoom(zoomFactor + 1);
  }

  function zoomOut() {
    zoom(Math.max(zoomFactor - 1, 1));
  }

  const seekToPointerPosition = useCallback((clientX: number) => {
    const container = timelineRef.current;
    if (!container || totalTime <= 0) return;

    const rect = container.getBoundingClientRect();
    const posInContainer = clientX - rect.left + container.scrollLeft;
    const ratio = Math.max(0, Math.min(posInContainer / container.scrollWidth, 1));
    setTime(ratio * totalTime);
  }, [totalTime, setTime]);

  const handlePlayheadPointerDown = useCallback((e: React.PointerEvent) => {
    const container = timelineRef.current;
    if (!container) return;

    e.preventDefault();
    e.stopPropagation();

    const pointerId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(pointerId);

    const onPointerMove = (ev: PointerEvent) => {
      seekToPointerPosition(ev.clientX);
    };

    const onPointerUp = (ev: PointerEvent) => {
      (ev.target as HTMLElement).releasePointerCapture(pointerId);
      (ev.target as HTMLElement).removeEventListener("pointermove", onPointerMove);
      (ev.target as HTMLElement).removeEventListener("pointerup", onPointerUp);
    };

    (e.currentTarget as HTMLElement).addEventListener("pointermove", onPointerMove);
    (e.currentTarget as HTMLElement).addEventListener("pointerup", onPointerUp);
  }, [seekToPointerPosition]);

  const handleTimelinePointerDown = useCallback((e: React.PointerEvent) => {
    const container = timelineRef.current;
    if (!container)
      return;

    e.preventDefault();
    setSelectedIndex(null);
    const startX = e.clientX;
    const startScroll = container.scrollLeft;
    const pointerId = e.pointerId;
    let didDrag = false;
    container.setPointerCapture(pointerId);

    const onPointerMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      if (Math.abs(delta) > 3) didDrag = true;
      container.scrollLeft = startScroll - delta;
    };

    const onPointerUp = (ev: PointerEvent) => {
      container.releasePointerCapture(pointerId);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);

      if (!didDrag) {
        seekToPointerPosition(ev.clientX);
      }
    };

    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
  }, [seekToPointerPosition]);

  function addCut() {
    const container = timelineRef.current;
    if (!container)
      return;

    const containerWidth = container.clientWidth;
    const timelineWidth = container.scrollWidth;
    const visibleTimeRange = (totalTime / timelineWidth) * containerWidth;
    const scrolledTime = (scrollLeft / timelineWidth) * totalTime;
    const centerVisibleTime = scrolledTime + visibleTimeRange / 2;

    const cutDuration = Math.max(0.5, visibleTimeRange / 4);
    const begin = Math.max(0, centerVisibleTime - cutDuration / 2);
    const end = Math.min(totalTime, begin + cutDuration);

    setEditList([...editList, {
      begin,
      end,
      kind: "CUT"
    }]);
  }

  const removeSelectedEditRegion = useCallback(() => {
    setEditList(editList.filter((_, j) => j !== selectedEditRegionIdx));
    setSelectedIndex(null);
  }, [editList]);

  const durationAfterCuts = (() => {
      let duration = totalTime;
      for (const edit of editList) {
          if (edit.kind === "CUT") {
              duration -= (edit.end - edit.begin);
          }
      }
      return Math.max(0, duration);
  })();

  return (
    <div className="flex flex-col h-50 w-full gap-4">
      <div 
        ref={timelineRef}
        className="w-full overflow-x-scroll h-full cursor-grab active:cursor-grabbing"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onPointerDown={handleTimelinePointerDown}
      >
        <div
          className="flex flex-col h-full relative"
          style={{ width: `${zoomFactor * 100}%` }}
        >
          {totalTime > 0 && (() => {
            const timestampCount = Math.max(2, Math.round(5 * zoomFactor));
            const rulerLineCount = Math.max(20, Math.round(150 * zoomFactor));
            const playheadPercent = (time / totalTime) * 100;

            return (
              <div ref={rulerRef} className="flex flex-col px-1 shrink-0 relative">
                <div className="flex justify-between">
                  {Array.from({ length: timestampCount }, (_, i) => {
                    const t = totalTime * (i / (timestampCount - 1));
                    return (
                      <span key={i} className="text-secondary select-none" style={{ fontSize: 16 }}>
                        {formatDuration(Math.round(t))}
                      </span>
                    );
                  })}
                </div>
                <div className="flex justify-between items-end h-3">
                  {Array.from({ length: rulerLineCount }, (_, i) => (
                    <div
                      key={i}
                      className="bg-secondary"
                      style={{
                        width: 1,
                        height: i % 5 === 0 ? 12 : 6,
                      }}
                    />
                  ))}
                </div>

                <div
                  ref={playheadRef}
                  className="absolute bottom-0 -translate-x-1/2 z-10 cursor-ew-resize drop-shadow"
                  style={{ left: `${playheadPercent}%`, marginBottom: -1 }}
                  onPointerDown={handlePlayheadPointerDown}
                >
                  <PlayheadIcon />
                </div>
              </div>
            );
          })()}

          <div
            className="flex flex-1 min-h-0 bg-darker relative border border-slate rounded-2xl overflow-hidden"
          >
          {
            filmstrip.map((x, i) => (
              <img
                src={x}
                key={i}
                alt=""
                draggable={false}
                className={clsx(
                  "h-full object-left select-none pointer-events-none",
                  zoomFactor > 6 ? "object-contain" : "object-cover"
                )}
                style={{ width: `${((1 / FILMSTRIP_COUNT) * 100)}%` }}
              />
            ))
          }

          {
            editList.map((x, i) => (
              <EditorEditRegion
                edit={x}
                setEdit={(updated) => setEditList(editList.map((e, j) => j === i ? updated : e))}
                totalDuration={totalTime}
                selected={selectedEditRegionIdx === i}
                onSelect={() => setSelectedIndex(i)}
              />
            ))
          }
          </div>

          {totalTime > 0 && (
            <div
              ref={playingStemRef}
              className="absolute pointer-events-none z-10 shadow-2xl"
              style={{
                left: `${(time / totalTime) * 100}%`,
                top: 0,
                bottom: -6,
                width: 2,
                transform: "translateX(-1px)",
                background: "#fff",
                borderRadius: "0 0 1px 1px",
              }}
            />
          )}
        </div>
      </div>

      <div className="flex justify-between items-center">
        <div className="flex gap-2">
          <Button icon={playing ? <PauseIcon width={16} height={16} /> : <PlayIcon width={16} height={16} />} onClick={() => togglePlayback()} />
          <Button icon="zoom-in" onClick={() => zoomIn()}/>
          <Button icon="zoom-out" onClick={() => zoomOut()}/>
          <Button icon={<CutIcon />} onClick={() => addCut()}>Add cut</Button>

          {selectedEditRegionIdx !== null && (
            <Button icon="delete" onClick={() => removeSelectedEditRegion()}>Remove cut</Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {
            process.env["NODE_ENV"] === "development" &&
              <span className="font-mono text-xs">session={videoRef.current?.src}</span>
          }

          <div className="flex items-center gap-2 text-white mr-6">
            <Icon glyph="clock-fill" size={16} />
            <span className="text-base">
              <b>{formatDuration(Math.round(durationAfterCuts))}</b> after cuts
            </span>
          </div>

          <div className="flex gap-2">
            <Button icon="post-fill" onClick={onSaveAndExit}>Save and exit</Button>
            <Button icon="send-fill" onClick={onPublish} kind="primary">Publish</Button>
          </div>
        </div>
      </div>
    </div>
  )
}