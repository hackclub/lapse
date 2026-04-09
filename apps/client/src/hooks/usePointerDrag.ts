import { useCallback } from "react";

export function usePointerDrag(onDragStart: () => void, onDrag: (deltaX: number) => void) {
  return useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    if (!(target instanceof HTMLElement))
      return;

    onDragStart();

    const startX = e.clientX;
    const pointerId = e.pointerId;
    target.setPointerCapture(pointerId);

    const onPointerMove = (ev: PointerEvent) => {
      onDrag(ev.clientX - startX);
    };

    const onPointerUp = () => {
      target.releasePointerCapture(pointerId);
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
  }, [onDragStart, onDrag]);
}
