import NextLink from "next/link";
import { AnimatePresence, motion } from "motion/react";
import Icon from "@hackclub/icons";

import { useReadyDrafts } from "@/context/ReadyDraftsContext";
import { timeAgo } from "@/timeAgo";

const MotionLink = motion.create(NextLink);

/** The home page's row of recordings waiting for a name. Nothing at all when there are none. */
export function ReadyToPublishShelf() {
  const drafts = useReadyDrafts();

  return (
    <AnimatePresence initial={false}>
      {drafts && drafts.length > 0 && (
        <motion.section
          key="ready-shelf"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="flex flex-col w-full gap-4 overflow-hidden"
        >
          <div className="flex items-center gap-3 pt-2">
            <h2 className="font-bold text-2xl">Ready to publish</h2>
            <span className="rounded-full bg-red text-white text-sm font-bold px-2.5 py-0.5 tabular-nums">
              {drafts.length}
            </span>
          </div>

          <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-6 -mx-2 px-2">
            <AnimatePresence initial={true} mode="popLayout">
              {drafts.map((draft, i) => (
                <MotionLink
                  key={draft.id}
                  href={`/timelapse/publish/${draft.id}`}
                  layout
                  initial={{ opacity: 0, y: 24, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 380, damping: 26, delay: i * 0.04 }}
                  className="group snap-start shrink-0 flex flex-col gap-3 w-64 p-2.5 rounded-3xl bg-darkless border border-white/5 shadow-[0_8px_24px_rgb(0_0_0/0.25)]"
                >
                  <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-darker flex items-center justify-center">
                    {draft.thumbnailUrl
                      ? <img src={draft.thumbnailUrl} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      : <Icon glyph="clock-fill" size={40} className="text-muted" />}

                    {draft.compiling && (
                      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-dark/80 backdrop-blur px-2.5 py-1 text-xs font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow animate-pulse" />
                        Finishing up
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5">
                    <span className="text-sm text-muted">Recorded {timeAgo(draft.createdAt)}</span>
                    <span className="rounded-full bg-red text-white text-sm font-bold px-3.5 py-1.5 transition-[filter] group-hover:brightness-110">
                      Publish
                    </span>
                  </div>
                </MotionLink>
              ))}
            </AnimatePresence>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
