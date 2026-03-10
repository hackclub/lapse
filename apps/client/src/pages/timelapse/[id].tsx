import NextLink from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Icon from "@hackclub/icons";
import type { Timelapse, TimelapseVisibility, Comment } from "@hackclub/lapse-api";

import { api } from "@/api";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";
import { useAuth } from "@/hooks/useAuth";
import { markdownToJsx } from "@/markdown";

import RootLayout from "@/components/layout/RootLayout";
import { ErrorModal } from "@/components/layout/ErrorModal";
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
import { Duration } from "@/components/Duration";
import { sleep } from "@/common";

export default function Page() {
  const router = useRouter();
  const { currentUser } = useAuth(false);

  const [timelapse, setTimelapse] = useState<Timelapse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorIsCritical, setErrorIsCritical] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<TimelapseVisibility>("PUBLIC");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [hackatimeModalOpen, setHackatimeModalOpen] = useState(false);
  const [localComments, setLocalComments] = useState<Comment[]>(timelapse?.comments ?? []);
  const [formattedDescription, setFormattedDescription] = useState<React.ReactNode>("");

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
        setError("Invalid timelapse ID provided");
        setErrorIsCritical(true);
        return;
      }

      console.log("([id].tsx) querying timelapse...");

      let timelapse: Timelapse | null = null;

      while (true) {
        const res = await api.timelapse.query({ id });
        if (!res.ok) {
          if (!timelapse) {
            console.error("([id].tsx) couldn't fetch that timelapse!", res);
            setError(res.message);
            setErrorIsCritical(true);
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
    catch (apiErr) {
      console.error("([id].tsx) error loading timelapse:", apiErr);
      setError(apiErr instanceof Error ? apiErr.message : "An unknown error occurred while loading the timelapse");
      setErrorIsCritical(true);
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

  return (
    <RootLayout showHeader={true} title={timelapse ? `${timelapse.name} - Lapse` : "Lapse"}>
      <div className="flex flex-col md:flex-row h-full pb-48 gap-8 md:gap-12 md:px-16 md:pb-16">
        <div className="flex flex-col gap-4 w-full md:w-2/3 h-min">
          { timelapse && !timelapse.playbackUrl ? (
            <div className="aspect-video w-full h-min md:rounded-2xl bg-[#000] flex items-center justify-center">
              <p className="text-secondary text-xl">
                { timelapse.visibility === "FAILED_PROCESSING"
                  ? "This timelapse could not be processed."
                  : "This timelapse is processing - please hold on!" }
              </p>
            </div>
          ) : (
            <video 
              controls
              src={timelapse?.playbackUrl ?? undefined}
              poster={timelapse?.thumbnailUrl ?? undefined}
              className="aspect-video w-full h-min md:rounded-2xl bg-[#000]"
            />
          ) }

          <div className="flex gap-3 w-full px-6 md:px-0">
            {
              isOwned ? (
                <>
                  <Button className="gap-2 w-full" onClick={handleEdit}>
                    <Icon glyph="edit" size={24} />
                    Edit details
                  </Button>
                  { timelapse.playbackUrl && !timelapse.private?.hackatimeProject && (
                    <Button className="gap-2 w-full" onClick={() => setHackatimeModalOpen(true)}>
                      <Icon glyph="history" size={24} />
                      Sync with Hackatime
                    </Button>
                  ) }
                </>
              ) : (
                <>
                  <Button onClick={() => alert("Sorry, not implemented yet!")} className="gap-2 w-full">
                    <Icon glyph="flag-fill" size={24} />
                    Report
                  </Button>
                </>
              )
            }
          </div>
        </div>

        <div className="w-full md:w-1/3 pl-3 flex flex-col gap-4 md:h-[70vh]">
          <div className="flex flex-col gap-2 px-4 md:px-0">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-4xl font-bold text-smoke leading-tight wrap-break-word min-w-0">
                  { timelapse?.name || <Skeleton /> }
                </h1>

                { timelapse && timelapse.visibility === "UNLISTED" && (
                  <Badge variant="default">UNLISTED</Badge>
                ) }
              </div>
            </div>
            
            <div className="flex items-center gap-3 mb-4">
              <ProfilePicture 
                isSkeleton={timelapse == null}
                user={timelapse?.owner ?? null}
                size="sm"
              />

              <div className="text-secondary text-xl flex gap-x-3 text-nowrap flex-wrap">
                <span>
                  by { !timelapse ? <Skeleton /> : <NextLink href={`/user/@${timelapse.owner.handle}`}><span className="font-bold">@{timelapse.owner.displayName}</span></NextLink> }
                </span>

                <Bullet />

                <span className="flex gap-1 sm:gap-2">
                  { !timelapse ? <Skeleton /> : <><TimeAgo date={timelapse.createdAt} /> <Bullet/><Duration seconds={timelapse.duration}/> </>}
                </span>

                { timelapse && timelapse.private?.hackatimeProject && (
                  <>
                    <Bullet />
                    <code className="text-secondary font-mono text-lg">{timelapse.private.hackatimeProject}</code>
                  </>
                ) }
              </div>
            </div>

            <p className="text-white text-xl leading-relaxed">
              { timelapse != null ? formattedDescription : <Skeleton lines={3} /> }
            </p>
          </div>
          
          { timelapse && timelapse.visibility === "UNLISTED" && isOwned && (
            <Alert variant="warning" icon="private-fill">
              <p>
                This timelapse is unlisted and can only be viewed via the link or by staff. Click on
                "Edit details" to change this.
              </p>
            </Alert>
          )}

          { timelapse && timelapse.visibility === "FAILED_PROCESSING" && isOwned && (
            <Alert variant="error" icon="important">
              <div className="flex items-center gap-16">
                <p>
                  Something went wrong on our end when processing this timelapse. You can delete this placeholder go back to your draft
                  to try again.
                </p>
                
                { timelapse.private?.sourceDraftId && (
                  <Button onClick={handleReturnToDraft} disabled={isDeleting} kind="error">
                    {isDeleting ? "Deleting..." : "Return to draft"}
                  </Button>
                ) }
              </div>
            </Alert>
          )}

          { timelapse && !timelapse.playbackUrl && timelapse.visibility !== "FAILED_PROCESSING" && (
            <Alert variant="info" icon="clock">
              <p>This timelapse is processing - hold on! We'll refresh when it's ready.</p>
            </Alert>
          )}

          { timelapse && (
            <CommentSection
              timelapseId={timelapse.id}
              comments={localComments}
              setComments={setLocalComments}
            />
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
        onClose={errorIsCritical ? () => router.back() : undefined}
      />
    </RootLayout>
  );
}
