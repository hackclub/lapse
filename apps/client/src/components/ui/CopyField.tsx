import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";

/**
 * A read-only field holding something the user has to take somewhere else - a link, a token - with a copy button
 * beside it. The value stays visible and selects itself on focus, because copying needs a secure context and the
 * user's permission, and a button that silently does nothing is worse than a field they can select by hand.
 */
export function CopyField({ value, label, className }: {
  value: string;

  /** Describes the value for screen readers, e.g. "Recording session link". */
  label: string;

  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Copying right before this unmounts would otherwise leave the timer to set state on a gone component.
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // No clipboard access - the field is selectable for exactly this case, so leave it be.
      return;
    }

    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={clsx("flex items-center gap-2 w-full", className)}>
      <input
        readOnly
        value={value}
        onFocus={e => e.currentTarget.select()}
        aria-label={label}
        className="flex-1 min-w-0 h-10 bg-darkless border border-slate rounded-lg px-3 text-xs font-mono text-secondary"
      />

      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied!" : "Copy"}
        aria-label={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
        className={clsx(
          "relative shrink-0 w-10 h-10 rounded-lg border border-slate bg-dark cursor-pointer",
          "transition-[background-color,transform] duration-150 hover:bg-darkless active:scale-95"
        )}
      >
        {/*
          The two glyphs are stacked and cross-faded rather than swapped: the tick grows out of the copy icon as
          that shrinks away, instead of the button blinking through an empty frame. Sharing one absolutely
          positioned box also centres them properly - the glyphs carry uneven padding inside their own viewBox,
          which is what knocks them off-centre when they're laid out as flex children.
        */}
        <span
          aria-hidden
          className={clsx(
            "absolute inset-0 flex items-center justify-center text-white",
            "transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            copied ? "scale-50 opacity-0 blur-[2px]" : "scale-100 opacity-100 blur-0"
          )}
        >
          <Icon glyph="copy" size={20} />
        </span>

        <span
          aria-hidden
          className={clsx(
            "absolute inset-0 flex items-center justify-center text-white",
            "transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            copied ? "scale-100 opacity-100 blur-0" : "scale-50 opacity-0 blur-[2px]"
          )}
        >
          {/*
            The checkmark's artwork sits off-centre inside its own 32x32 viewBox - its ink spans x 10.4-28.6,
            y 6.7-20.6, so its middle lands at (19.5, 13.6) instead of (16, 16). Flex centering aligns the box,
            not the mark inside it, so the tick reads high and to the right without this. The correction is a
            percentage of the icon's own size (-3.5/32 across, +2.4/32 down) rather than a pixel count, so it
            still holds if the glyph is ever rendered at another size.
          */}
          <Icon glyph="checkmark" size={20} className="translate-x-[-10.9%] translate-y-[7.4%]" />
        </span>
      </button>
    </div>
  );
}
