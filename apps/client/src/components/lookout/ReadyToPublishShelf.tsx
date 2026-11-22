import NextImage from "next/image";
import { useRouter } from "next/router";
import { AnimatePresence, motion } from "motion/react";
import Icon from "@hackclub/icons";

import { useReadyDrafts, type ReadyDraft } from "@/context/ReadyDraftsContext";
import { ShelfHeader } from "@/components/layout/ShelfHeader";
import { TimeAgo } from "@/components/TimeAgo";
import { navigateTo } from "@/navigation";
import { isOptimizableImage } from "@/remoteImages";

/** Laid out like `TimelapseCard`, so it sits naturally above the feed - with a Publish badge where the duration would be. */
function ReadyCard({ draft, index }: {
  draft: ReadyDraft;
  index: number;
}) {
  const router = useRouter();
  const href = `/timelapse/publish/${draft.id}`;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 30, delay: index * 0.05 }}
      onClick={e => navigateTo(router, href, e)}
      onAuxClick={e => e.button === 1 && navigateTo(router, href, e)}
      role="button"
      className="group flex flex-col gap-4 sm:gap-5 cursor-pointer sm:max-w-80"
    >
      <div role="img" className="relative w-full aspect-video rounded-lg sm:rounded-2xl overflow-hidden">
        {draft.thumbnailUrl
          ? (
            <NextImage
              src={draft.thumbnailUrl}
              alt=""
              fill
              sizes="(min-width: 640px) 320px, 50vw"
              unoptimized={!isOptimizableImage(draft.thumbnailUrl)}
              className="block w-full h-full object-cover transition-all group-hover:brightness-75"
            />
          )
          : (
            <div className="bg-slate w-full h-full flex items-center justify-center">
              <Icon glyph="clock" size={32} className="text-muted" />
            </div>
          )}

        {draft.compiling && (
          <div className="absolute bottom-1 left-1 sm:bottom-2 sm:left-2 flex items-center gap-1.5 bg-black/80 text-white text-xs sm:text-sm px-1 sm:px-1.5 py-0.5 rounded font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow animate-pulse" />
            Finishing up
          </div>
        )}

        <div className="absolute bottom-1 right-1 sm:bottom-2 sm:right-2 bg-red text-white text-xs sm:text-sm px-1.5 sm:px-2 py-0.5 rounded font-bold transition-transform group-hover:scale-105">
          Publish
        </div>
      </div>

      <div className="flex flex-col w-full">
        <h1 className="font-bold text-md leading-none sm:leading-normal sm:text-xl">Unpublished timelapse</h1>
        <h2 className="text-md sm:text-xl text-secondary">
          Recorded <b><TimeAgo date={draft.createdAt} /></b>
        </h2>
      </div>
    </motion.article>
  );
}

/** The home page's shelf of finished recordings that haven't been published. Absent when there are none. */
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
          transition={{ type: "spring", stiffness: 260, damping: 32 }}
          className="flex flex-col w-full overflow-hidden"
        >
          <div className="flex flex-col gap-12 pb-12 md:pb-20">
            <ShelfHeader
              icon="/images/orpheus-time.png"
              title="Ready to Publish"
              description={drafts.length === 1
                ? "You've got a timelapse waiting - publish it to make it count!"
                : `You've got ${drafts.length} timelapses waiting - publish them to make them count!`}
            />

            <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,22rem)] justify-between w-full gap-4 sm:gap-y-12">
              <AnimatePresence mode="popLayout">
                {drafts.map((draft, i) => <ReadyCard key={draft.id} draft={draft} index={i} />)}
              </AnimatePresence>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
