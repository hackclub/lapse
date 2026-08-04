import NextLink from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import type { Timelapse, TimelapseVisibility, Comment } from "@hackclub/lapse-api";

import { api } from "@/api";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";
import { useAuth } from "@/hooks/useAuth";
import { markdownToJsx } from "@/markdown";

import RootLayout from "@/components/layout/RootLayout";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { NOT_FOUND_STATUS, PageStatus, SERVER_ERROR_STATUS, StatusPage, statusForApiError } from "@/components/layout/StatusPage";
import { ProfilePicture } from "@/components/entity/ProfilePicture";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { WindowedModal } from "@/components/layout/WindowedModal";
import { HackatimeSelectModal } from "@/components/layout/HackatimeSelectModal";
import { TextInput } from "@/components/ui/TextInput";
import { TextareaInput } from "@/components/ui/TextareaInput";
import { VisibilityPicker } from "@/components/layout/VisibilityPicker";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { Bullet } from "@/components/ui/Bullet";
import { TimeAgo } from "@/components/TimeAgo";
import { CommentSection } from "@/components/entity/CommentSection";
import { TimelapsePlayer } from "@/components/entity/TimelapsePlayer";
import { Duration } from "@/components/Duration";
import { sleep } from "@hackclub/lapse-shared";

/*
  The video runs the full width of the window, and its height is capped so that the title and author underneath it
  are still on screen when the page loads. A window wider than 16:9 therefore ends up with the video centred in a
  band of black - the same trade YouTube's theatre mode makes, and the reason it feels like a screening rather than
  a page with a video on it.
*/
const THEATRE_MAX_HEIGHT = "max-h-[calc(100dvh_-_20rem)]";
const THEATRE_BAND = `w-full aspect-video ${THEATRE_MAX_HEIGHT}`;

export default function Page() {
  const router = useRouter();
  const { currentUser } = useAuth(false);

  const [timelapse, setTimelapse] = useState<Timelapse | null>(null);

  // A timelapse we can't load leaves nothing to show, so it takes over the page. Everything past that point is
  // recoverable, and stays a modal over the timelapse the user is already looking at.
  const [loadStatus, setLoadStatus] = useState<PageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<TimelapseVisibility>("PUBLIC");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [hackatimeModalOpen, setHackatimeModalOpen] = useState(false);
  const [localComments, setLocalComments] = useState<Comment[]>(timelapse?.comments ?? []);
  const [formattedDescription, setFormattedDescription] = useState<React.ReactNode>("");
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!timelapse)
      return;

    setFormattedDescription(markdownToJsx(timelapse.description));
    setLocalComments(timelapse.comments);
  }, [timelapse]);

  const isOwned = timelapse && currentUser && currentUser.id === timelapse.owner.id;

  useAsyncEffect(async () => {
    if (!router.isReady)
      return;

    try {
      const { id } = router.query;

      if (!id || typeof id !== "string") {
        setLoadStatus(NOT_FOUND_STATUS);
        return;
      }

      console.log("([id].tsx) querying timelapse...");

      let timelapse: Timelapse | null = null;

      while (true) {
        const res = await api.timelapse.query({ id });
        if (!res.ok) {
          if (!timelapse) {
            console.error("([id].tsx) couldn't fetch that timelapse!", res);
            setLoadStatus(statusForApiError(res.error, res.message));
            break;
          }

          continue;
        }

        timelapse = res.data.timelapse;
        console.log("([id].tsx) timelapse fetched!", timelapse);
        setTimelapse(timelapse);

        if (timelapse.playbackUrl) {
          break;
        }

        if (timelapse.visibility === "FAILED_PROCESSING")
          break;

        await sleep(5000);
      }
    }
    catch (error) {
      console.error("([id].tsx) error loading timelapse:", error);
      setLoadStatus(SERVER_ERROR_STATUS);
    }
  }, [router, router.isReady]);

  function handleEdit() {
    if (!timelapse)
      return;

    setEditName(timelapse.name);
    setEditDescription(timelapse.description);
    setEditVisibility(timelapse.visibility);
    setEditModalOpen(true);
  };

  async function handleUpdate() {
    if (!timelapse)
      return;

    try {
      setIsUpdating(true);

      const result = await api.timelapse.update({
        id: timelapse.id,
        changes: {
          name: editName.trim(),
          description: editDescription.trim(),
          visibility: editVisibility
        }
      });

      if (result.ok) {
        setTimelapse(result.data.timelapse);
        setEditModalOpen(false);
      }
      else {
        setError(`Failed to update: ${result.error}`);
      }
    }
    catch (error) {
      console.error("([id].tsx) error updating timelapse:", error);
      setError(error instanceof Error ? error.message : "An error occurred while updating the timelapse.");
    }
    finally {
      setIsUpdating(false);
    }
  };

  const isUpdateDisabled = !editName.trim() || isUpdating;

  async function handleReturnToDraft() {
    if (!timelapse?.private?.sourceDraftId)
      return;

    const draftId = timelapse.private.sourceDraftId;

    try {
      setIsDeleting(true);
      await api.timelapse.delete({ id: timelapse.id });
      router.push(`/draft/${draftId}`);
    }
    catch (error) {
      console.error("([id].tsx) error deleting failed timelapse:", error);
      setError(error instanceof Error ? error.message : "An error occurred while deleting the timelapse.");
      setIsDeleting(false);
    }
  }

  async function handleDeleteTimelapse() {
    if (!timelapse || !isOwned)
      return;

    if (!window.confirm("Are you sure you want to delete this timelapse? This action cannot be undone."))
      return;

    try {
      setIsDeleting(true);

      const result = await api.timelapse.delete({ id: timelapse.id });

      if (result.ok) {
        router.push(`/user/@${timelapse.owner.handle}`);
      }
      else {
        setError(`Failed to delete: ${result.error}`);
      }
    }
    catch (error) {
      console.error("([id].tsx) error deleting timelapse:", error);
      setError(error instanceof Error ? error.message : "An error occurred while deleting the timelapse.");
    }
    finally {
      setIsDeleting(false);
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }

  if (loadStatus) {
    return <StatusPage {...loadStatus} />;
  }

  const isProcessing = timelapse != null && !timelapse.playbackUrl && timelapse.visibility !== "FAILED_PROCESSING";
  const hasFailed = timelapse?.visibility === "FAILED_PROCESSING";

  return (
    <RootLayout showHeader={true} title={timelapse ? `${timelapse.name} - Lapse` : "Lapse"}>
      <div className="w-full flex flex-col pb-16">
        {/*
          The video is the page, and it gets the whole width of the window to be it in. Everything else is arranged
          underneath in the order someone actually wants it: what this is, who made it, and how much of their time it
          took.
        */}
        { !timelapse ? (
          <div className={clsx(THEATRE_BAND, "bg-darker animate-pulse")} />
        ) : !timelapse.playbackUrl ? (
          <div className={clsx(THEATRE_BAND, "bg-[#000] flex flex-col items-center justify-center gap-5 px-6 text-center")}>
            { hasFailed ? (
              <>
                <Icon glyph="important" size={48} className="text-red" />
                <p className="text-secondary text-lg sm:text-xl">This timelapse could not be processed.</p>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-white animate-spin" />
                <p className="text-secondary text-lg sm:text-xl">This timelapse is processing - hold on!</p>
              </>
            ) }
          </div>
        ) : (
          <TimelapsePlayer
            src={timelapse.playbackUrl}
            poster={timelapse.thumbnailUrl ?? undefined}
            realDuration={timelapse.duration}
            keyboardShortcuts={!editModalOpen && !hackatimeModalOpen && !error}
            className={THEATRE_MAX_HEIGHT}
          />
        ) }

        <div className="w-full max-w-[80rem] mx-auto flex flex-col gap-3 px-4 sm:px-12 pt-5 sm:pt-6">
          {/*
            The title gets a line of its own, the way it does on YouTube. Sharing one with the buttons left it pinned
            to the top of a row as tall as they are, and the empty half of that row underneath read as a paragraph
            break between the title and the person who made it.
          */}
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-smoke leading-tight wrap-break-word min-w-0">
              { timelapse?.name || <Skeleton className="w-64" /> }
            </h1>

            { timelapse?.visibility === "UNLISTED" && (
              <Badge variant="default">UNLISTED</Badge>
            ) }
          </div>

          {/* Who made it and what it cost them on the left; everything you can do about it on the right. */}
          <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4">
            <div className="flex items-center gap-3 min-w-0">
              <ProfilePicture
                isSkeleton={timelapse == null}
                user={timelapse?.owner ?? null}
                size="md"
              />

              <div className="flex flex-col min-w-0 leading-tight gap-1">
                { timelapse ? (
                  <NextLink
                    href={`/user/@${timelapse.owner.handle}`}
                    className="font-bold text-white truncate hover:underline"
                  >
                    @{timelapse.owner.displayName}
                  </NextLink>
                ) : (
                  <Skeleton className="w-32" />
                ) }

                {/*
                  One line of facts about the recording, set at the size facts deserve. The tracked time is the only
                  one of them anybody came here for, so it's the only one carrying any weight - and it's spelled out
                  ("2h 34m") rather than clocked, because it isn't a position in the video.
                */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-secondary min-w-0">
                  { timelapse ? <TimeAgo date={timelapse.createdAt} /> : <Skeleton className="w-20" /> }

                  <Bullet />

                  <span className="flex items-center gap-1.5">
                    <Icon glyph="stopwatch" size={16} className="shrink-0" />

                    <b className="text-white">
                      { timelapse ? <Duration seconds={timelapse.duration} format="long" /> : <Skeleton className="w-8" /> }
                    </b>

                    tracked
                  </span>

                  { timelapse?.private?.hackatimeProject && (
                    <>
                      <Bullet />

                      <span className="flex items-center gap-1.5 min-w-0">
                        on Hackatime as
                        <code className="font-mono text-smoke truncate">
                          {timelapse.private.hackatimeProject}
                        </code>
                      </span>
                    </>
                  ) }
                </div>
              </div>
            </div>

            { timelapse && (
              <div className="flex items-center gap-2 shrink-0">
                { isOwned ? (
                  <>
                    <Button
                      className="px-6!"
                      icon={<Icon glyph="edit" size={24} />}
                      onClick={handleEdit}
                    >
                      Edit
                    </Button>

                    { timelapse.playbackUrl && !timelapse.private?.hackatimeProject && (
                      <Button
                        className="px-6!"
                        icon={<Icon glyph="history" size={24} />}
                        onClick={() => setHackatimeModalOpen(true)}
                      >
                        <span className="hidden sm:inline">Sync with </span>Hackatime
                      </Button>
                    ) }
                  </>
                ) : (
                  <Button
                    title="Report this timelapse"
                    icon={<Icon glyph="flag-fill" size={24} />}
                    onClick={() => alert("Sorry, not implemented yet!")}
                  />
                ) }

                <Button
                  className={clsx(linkCopied && "text-green!")}
                  title={linkCopied ? "Link copied!" : "Copy a link to this timelapse"}
                  icon={<Icon glyph={linkCopied ? "checkmark" : "link"} size={24} />}
                  onClick={handleCopyLink}
                />
              </div>
            ) }
          </div>

          { !timelapse ? (
            <Skeleton lines={2} />
          ) : timelapse.description.trim().length > 0 && (
            <p className="text-smoke leading-relaxed wrap-break-word">
              {formattedDescription}
            </p>
          ) }

          { timelapse?.visibility === "UNLISTED" && isOwned && (
            <Alert variant="warning" icon="private-fill">
              <p>
                This timelapse is unlisted and can only be viewed via the link or by staff. Click on
                "Edit" to change this.
              </p>
            </Alert>
          )}

          { hasFailed && isOwned && (
            <Alert variant="error" icon="important">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                <p>
                  Something went wrong on our end when processing this timelapse. You can delete this placeholder go back to your draft
                  to try again.
                </p>

                { timelapse.private?.sourceDraftId && (
                  <Button onClick={handleReturnToDraft} disabled={isDeleting} kind="error" className="shrink-0">
                    {isDeleting ? "Deleting..." : "Return to draft"}
                  </Button>
                ) }
              </div>
            </Alert>
          )}

          { isProcessing && (
            <Alert variant="info" icon="clock">
              <p>This timelapse is processing - hold on! We'll refresh when it's ready.</p>
            </Alert>
          )}

          {/* Comments are the least of what anyone comes here for, so they go last, under a rule and nothing else. */}
          { timelapse && (
            <div className="border-t border-black pt-5">
              <CommentSection
                timelapseId={timelapse.id}
                comments={localComments}
                setComments={setLocalComments}
              />
            </div>
          ) }
        </div>
      </div>

      <WindowedModal
        icon="edit"
        title="Edit timelapse"
        description="Update your timelapse name and description."
        isOpen={editModalOpen}
        setIsOpen={setEditModalOpen}
      >
        <div className="flex flex-col gap-6">
          <TextInput
            field={{
              label: "Name",
              description: "The title of your timelapse."
            }}
            value={editName}
            onChange={setEditName}
            maxLength={60}
          />

          <TextareaInput
            label="Description"
            description="Displayed under your timelapse. Optional."
            value={editDescription}
            onChange={setEditDescription}
            maxLength={280}
          />

          <VisibilityPicker
            value={editVisibility}
            onChange={setEditVisibility}
          />

          <Button onClick={handleUpdate} disabled={isUpdateDisabled} kind="primary">
            {isUpdating ? "Updating..." : "Update"}
          </Button>

          <div className="flex flex-col gap-2 pt-4 border-t border-slate">
            <Button onClick={handleDeleteTimelapse} disabled={isDeleting} kind="destructive">
              <Icon glyph="delete" size={24} />
              {isDeleting ? "Deleting..." : "Delete Timelapse"}
            </Button>
          </div>
        </div>
      </WindowedModal>

      { timelapse && timelapse.private && !timelapse.private.hackatimeProject && (
        <HackatimeSelectModal
          isOpen={hackatimeModalOpen}
          setIsOpen={setHackatimeModalOpen}
          onError={setError}
          onAccept={async (key) => {
            if (!key)
              return;

            const syncRes = await api.timelapse.syncWithHackatime({ id: timelapse.id, hackatimeProject: key });
            if (!syncRes.ok) {
              console.error("([id].tsx) could not synchronize timelapse with Hackatime!", syncRes);
              setError(syncRes.message);
              return;
            }

            const res = await api.timelapse.query({ id: timelapse.id });
            if (res.ok) {
              setTimelapse(res.data.timelapse);
            }
          }}
        />
      ) }

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
      />
    </RootLayout>
  );
}
