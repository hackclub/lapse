import React, { useCallback } from "react";
import clsx from "clsx";
import { EditListEntry } from "@hackclub/lapse-api";
import { formatDuration } from "@hackclub/lapse-shared";

import { usePointerDrag } from "@/hooks/usePointerDrag";

function EditorEditRegionHandle({ side, onDragStart, onDrag }: {
  side: "IN" | "OUT",
  onDragStart: () => void,
  onDrag: (deltaX: number) => void
}) {
  const handlePointerDown = usePointerDrag(onDragStart, onDrag);

  return (
    <div
      onPointerDown={handlePointerDown}
      className={clsx(
        "absolute flex justify-center items-center w-4 h-1/2 shadow-xl rounded-sm bg-[#fff] cursor-ew-resize border border-slate",
        side == "IN" && "left-0 -translate-x-2",
        side == "OUT" && "right-0 translate-x-2"
      )}
    >
      <div className="w-px h-1/3 bg-[#000]" />
    </div>
  );
}

export function EditorEditRegion({ edit, setEdit, totalDuration, selected, onSelect }: {
  edit: EditListEntry,
  setEdit: (x: EditListEntry) => void,
  totalDuration: number,
  selected: boolean,
  onSelect: () => void
}) {
  const areaDuration = edit.end - edit.begin;
  const containerRef = React.useRef<HTMLDivElement>(null);

  function getTimelineWidth() {
    return containerRef.current?.parentElement?.getBoundingClientRect().width ?? 1;
  }

  const dragOriginRef = React.useRef(edit);
  const editRef = React.useRef(edit);
  editRef.current = edit;

  const handleDragStart = useCallback(
    () => {
      dragOriginRef.current = editRef.current;
      onSelect();
    },
    [onSelect]
  );

  const getDragTimeDelta = useCallback(
    (deltaX: number) => {
      return deltaX / (getTimelineWidth() / totalDuration);
    },
    [getTimelineWidth, totalDuration]
  );

  const handleInDrag = useCallback(
    (deltaX: number) => {
      const origin = dragOriginRef.current;
      const newBegin = Math.max(0, Math.min(origin.begin + getDragTimeDelta(deltaX), origin.end - 0.1));
      setEdit({ ...origin, begin: newBegin });
    },
    [getDragTimeDelta, setEdit]
  );

  const handleOutDrag = useCallback(
    (deltaX: number) => {
      const origin = dragOriginRef.current;
      const newEnd = Math.max(origin.begin + 0.1, Math.min(origin.end + getDragTimeDelta(deltaX), totalDuration));
      setEdit({ ...origin, end: newEnd });
    },
    [getDragTimeDelta, totalDuration, setEdit]
  );

  const handleMoveDrag = useCallback(
    (deltaX: number) => {
      const origin = dragOriginRef.current;
      const duration = origin.end - origin.begin;
      const newBegin = Math.max(0, Math.min(origin.begin + getDragTimeDelta(deltaX), totalDuration - duration));
      setEdit({ ...origin, begin: newBegin, end: newBegin + duration });
    },
    [getDragTimeDelta, totalDuration, setEdit]
  );

  const handleAreaPointerDown = usePointerDrag(handleDragStart, handleMoveDrag);

  return (
    <div
      ref={containerRef}
      onPointerDown={handleAreaPointerDown}
      className={clsx(
        "absolute flex justify-center items-center h-full bg-[#00000050] border backdrop-blur-sm rounded-md select-none cursor-grab active:cursor-grabbing",
        selected ? "border-red" : "border-slate"
      )}
      style={{
        left: `${(edit.begin / totalDuration) * 100}%`,
        width: `${((edit.end - edit.begin) / totalDuration) * 100}%`
      }}
    >
      <EditorEditRegionHandle side="IN" onDragStart={handleDragStart} onDrag={handleInDrag} />
      <span className="font-bold text-base">{formatDuration(areaDuration)}</span>
      <EditorEditRegionHandle side="OUT" onDragStart={handleDragStart} onDrag={handleOutDrag} />
    </div>
  )
}