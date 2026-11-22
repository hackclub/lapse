import type { NextRouter } from "next/router";
import { motion } from "motion/react";
import { toast } from "sonner";
import Icon from "@hackclub/icons";

import type { ReadyDraft } from "@/context/ReadyDraftsContext";
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

export function showReadyToPublishToast(drafts: ReadyDraft[], router: NextRouter) {
  const oldest = drafts[0];

  toast(drafts.length === 1 ? "Your timelapse is ready" : `${drafts.length} timelapses are ready`, {
    id: TOAST_ID,
    description: drafts.length === 1 ? `Recorded ${timeAgo(oldest.createdAt)}` : "Publish them to make them count",
    icon: <ThumbnailStack drafts={drafts} />,
    action: {
      label: "Publish",
      onClick: () => router.push(`/timelapse/publish/${oldest.id}`),
    },
    // Stays until closed: no timeout, and the Toaster has swiping off.
    duration: Infinity,
    closeButton: true,
  });
}
