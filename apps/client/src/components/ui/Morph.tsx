import { TextMorph } from "torph/react";

/**
 * Text that animates between values instead of snapping, via Torph (https://torph.lochie.me). Numbers roll by
 * place value, so `1min` to `2min` only moves the digit that changed.
 *
 * Meant for text that changes while someone is looking at it - a button going from "Save" to "Saving...", a
 * running timer. The first render never animates, and Torph turns itself off for `prefers-reduced-motion`.
 */
export function Morph({ children, className }: {
  children: string | number;
  className?: string;
}) {
  return <TextMorph className={className}>{children}</TextMorph>;
}
