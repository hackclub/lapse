import type { NextRouter } from "next/router";
import { motion } from "motion/react";
import { toast } from "sonner";
import clsx from "clsx";
import Icon from "@hackclub/icons";

import type { ReadyDraft } from "@/context/ReadyDraftsContext";
import { phantomSans } from "@/fonts";
import { timeAgo } from "@/timeAgo";

const TOAST_ID = "ready-to-publish";

/** Up to three thumbnails fanned out like a little hand of cards. */
export function ThumbnailStack({ drafts, size = 56 }: {
  drafts: ReadyDraft[];
  size?: number;
}) {
  const shown = drafts.slice(0, 3);

  return (
    <div className="relative shrink-0" style={{ width: size + (shown.length - 1) * 8, height: size }}>
      {shown.map((draft, i) => (
        <motion.div
          key={draft.id}
          initial={{ scale: 0.6, opacity: 0, rotate: 0 }}
          animate={{ scale: 1, opacity: 1, rotate: (i - (shown.length - 1) / 2) * 7 }}
          transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.08 + i * 0.05 }}
          className="absolute top-0 rounded-lg overflow-hidden bg-slate border-2 border-dark shadow-lg flex items-center justify-center"
          style={{ left: i * 8, width: size, height: size, zIndex: shown.length - i }}
        >
          {draft.thumbnailUrl
            ? <img src={draft.thumbnailUrl} alt="" className="w-full h-full object-cover" />
            : <Icon glyph="clock" size={size * 0.45} className="text-muted" />}
        </motion.div>
      ))}
    </div>
  );
}

function ReadyToPublishToast({ drafts, router }: {
  drafts: ReadyDraft[];
  router: NextRouter;
}) {
  const oldest = drafts[0];
  const title = drafts.length === 1
    ? "Your timelapse is ready"
    : `${drafts.length} timelapses are ready`;

  const subtitle = drafts.length === 1
    ? `Recorded ${timeAgo(oldest.createdAt)}`
    : "Publish them to make them count";

  function publish() {
    toast.dismiss(TOAST_ID);
    router.push(`/timelapse/publish/${oldest.id}`);
  }

  return (
    <div className={clsx(
      "flex items-center gap-3.5 w-[min(calc(100vw-32px),420px)] p-3 rounded-2xl",
      "bg-dark border border-slate shadow-[0_16px_48px_rgb(0_0_0/0.5)] text-white",
      phantomSans.className
    )}>
      <ThumbnailStack drafts={drafts} />

      <div className="flex flex-col flex-1 min-w-0">
        <span className="font-bold leading-tight">{title}</span>
        <span className="text-sm text-secondary truncate">{subtitle}</span>
      </div>

      <motion.button
        onClick={publish}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
        className="shrink-0 rounded-2xl h-10 bg-red text-white font-bold px-5 cursor-pointer"
      >
        Publish
      </motion.button>

      <motion.button
        onClick={() => toast.dismiss(TOAST_ID)}
        whileTap={{ scale: 0.85 }}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
        aria-label="Close"
        className="shrink-0 -ml-1 flex items-center justify-center w-8 h-8 rounded-xl text-secondary hover:text-white hover:bg-darkless transition-colors cursor-pointer"
      >
        <Icon glyph="view-close" size={20} />
      </motion.button>
    </div>
  );
}

export function showReadyToPublishToast(drafts: ReadyDraft[], router: NextRouter) {
  toast.custom(() => <ReadyToPublishToast drafts={drafts} router={router} />, {
    id: TOAST_ID,
    // Stays until the close button: no timeout, no swipe.
    duration: Infinity,
    dismissible: false,
  });
}
