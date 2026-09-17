import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import type { TimelapseVisibility } from "@hackclub/lapse-api";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { useInterval } from "@/hooks/useInterval";
import { getStoredSessions, removeStoredSession, type StoredLookoutSession } from "@/components/lookout/sessions";
import { EditorModal } from "@/components/lookout/EditorModal";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { VisibilityPicker } from "@/components/layout/VisibilityPicker";
import { NOT_FOUND_STATUS, PageStatus, StatusPage, statusForApiError } from "@/components/layout/StatusPage";
import { HackatimeProjectPicker, prefetchHackatimeProjects } from "@/components/entity/HackatimeProjectPicker";

type CompilationStatus = "waiting" | "ready" | "failed";

/**
 * Publishing is a two-step flow - the user describes the timelapse, and then decides what to do with the time it
 * represents. The second step is not optional enough to be a modal, so it takes over the form instead.
 */
type PublishStep = "details" | "hackatime";

function StepMarker({ index, label, state }: {
  index: number;
  label: string;
  state: "done" | "current" | "upcoming";
}) {
  return (
    <div className={clsx("flex items-center gap-2 shrink-0", state === "upcoming" && "text-muted")}>
      <span className={clsx(
        "flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0",
        state === "current" && "bg-red text-white",
        state === "done" && "bg-green text-white",
        state === "upcoming" && "bg-darkless text-muted"
      )}>
        {state === "done" ? <Icon glyph="checkmark" size={16} /> : index}
      </span>

      <span className="font-bold text-sm">{label}</span>
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  useAuth(true);

  const rawId = router.query.id as string | undefined;
  const draftId = rawId && rawId !== "undefined" ? rawId : undefined;

  const [compilationStatus, setCompilationStatus] = useState<CompilationStatus>("waiting");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<TimelapseVisibility | null>(null);

  const [loadStatus, setLoadStatus] = useState<PageStatus | null>(null);
  const [step, setStep] = useState<PublishStep>("details");

  // Resuming an interrupted edit: if this page loads (e.g. after a refresh) while the
  // session's edit hold is still live, the cut/edit modal reopens instead of leaving
  // the user staring at the compile spinner until the hold lapses. The Lookout token
  // for the draft is only known on this device, via the recorder's stored sessions.
  const [storedSession, setStoredSession] = useState<StoredLookoutSession | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDone, setEditorDone] = useState(false);
  // Set from the status poll. Desktop recordings are edited in the desktop app, never here. `null` until a poll
  // says either way - the editor stays shut while we don't know, rather than guessing and opening it.
  const [recordedOnDesktop, setRecordedOnDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    // localStorage is client-only, so this can't run during render.
    if (!draftId) return;
    setStoredSession(getStoredSessions().find(s => s.draftId === draftId) ?? null);
  }, [draftId]);
  const [hackatimeProject, setHackatimeProject] = useState<string | null>(null);
  const [isLoadingHackatime, setIsLoadingHackatime] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The user is going to land on the Hackatime step in a minute or two - by then, the list should already be here.
  useEffect(() => {
    prefetchHackatimeProjects();
  }, []);

  useInterval(async () => {
    if (!draftId || loadStatus || compilationStatus !== "waiting") return;

    // The status poll comes first: it's what tells us whether this session was recorded on the desktop, which
    // the edit-hold probe below needs to know before it decides to open anything.
    let onDesktop = recordedOnDesktop;

    try {
      const res = await api.timelapse.pollLookoutStatus({ draftId });
      if (!res.ok) {
        // There's no form to show if the draft behind it is gone - and polling a draft that isn't there would
        // otherwise just keep raising the same modal every few seconds.
        setLoadStatus(statusForApiError(res.error, res.message));
        return;
      }

      onDesktop = res.data.recordedOnDesktop;
      setRecordedOnDesktop(onDesktop);

      // The user already answered all of this in the desktop app's publish panel, before the video
      // had finished compiling - so the timelapse published itself and there is nothing to ask.
      if (res.data.publishedTimelapseId) {
        removeStoredSession(draftId);
        location.href = `/timelapse/${res.data.publishedTimelapseId}`;
        return;
      }

      if (res.data.lookoutStatus === "complete") {
        setCompilationStatus("ready");
        setVideoUrl(res.data.videoUrl);
        setThumbnailUrl(res.data.thumbnailUrl);
      } else if (res.data.lookoutStatus === "failed") {
        setCompilationStatus("failed");
        setError("Video compilation failed. Please try recording again.");
      }
    } catch (err) {
      console.warn("(publish.tsx) poll error:", err);
    }

    // While the session's edit hold is live, offer to resume editing instead of
    // waiting out the hold. Asked directly of Lookout (the hold isn't visible through
    // Lapse's status poll), and only until a definitive answer: a live hold opens the
    // editor; a session past its hold can never become editable again, so stop asking.
    //
    // Desktop recordings are the exception. Their hold belongs to the desktop app's own editor window, which
    // is very likely open on this exact session right now - a second editor here would have both surfaces
    // renewing the same lease and racing to write cuts, last one winning. So we stay out of it and just wait
    // for the compile, which is what the user is watching the app finish anyway.
    if (storedSession && onDesktop === false && !editorOpen && !editorDone) {
      try {
        const res = await fetch(
          `${storedSession.lookoutApiBaseUrl}/api/sessions/${storedSession.lookoutToken}/status`
        );
        if (res.ok) {
          const status: { editable?: boolean; editHoldUntil?: string } = await res.json();
          if (status.editable || status.editHoldUntil) {
            setEditorOpen(true);
          } else {
            setEditorDone(true);
          }
        }
      } catch (err) {
        console.warn("(publish.tsx) edit-hold probe error:", err);
      }
    }
  }, 3000);

  function handleVisibilitySelect() {
    if (!visibility) return;
    setStep("hackatime");
  }

  async function publish(hackatimeProject: string | null) {
    if (!draftId || !visibility) return;

    setIsPublishing(true);

    try {
      const res = await api.timelapse.publishFromLookout({
        draftId,
        name: name.trim() || `Timelapse at ${new Date().toLocaleString("en-US", { month: "long", day: "numeric", minute: "numeric", hour: "numeric" })}`,
        description: description.trim(),
        visibility,
        ...(hackatimeProject ? { hackatimeProject } : {}),
      });

      if (!res.ok) {
        setError(res.message);
        setIsPublishing(false);
        return;
      }

      removeStoredSession(draftId);
      const timelapseId = res.data.timelapse.id;
      location.href = `/timelapse/${timelapseId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish timelapse");
      setIsPublishing(false);
    }
  }

  async function handleDiscard() {
    if (!draftId) return;

    if (!window.confirm("Are you sure you want to discard this timelapse? This action cannot be undone."))
      return;

    setIsDiscarding(true);

    try {
      await api.timelapse.discardLookoutDraft({ id: draftId });
    } catch {
      // Draft may already be gone
    }

    removeStoredSession(draftId);
    router.push("/");
  }

  if (loadStatus) {
    return <StatusPage {...loadStatus} />;
  }

  // The router hands us query parameters a render late, so an ID that never arrives is a malformed URL.
  if (!draftId) {
    return router.isReady
      ? <StatusPage {...NOT_FOUND_STATUS} />
      : (
        <RootLayout>
          <LoadingModal isOpen title="Loading" message="Loading timelapse..." />
        </RootLayout>
      );
  }

  return (
    <RootLayout>
      {/*
        Steps slide in from the side - the overflow is clipped this far out, so that nothing visibly cuts off.
        This uses "clip" rather than "hidden" so that the page keeps scrolling as one, instead of this becoming
        its own scroll container.
      */}
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-6 sm:py-12 overflow-x-clip">
        {compilationStatus === "waiting" && (
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="w-8 h-8 border-3 border-red border-t-transparent rounded-full animate-spin" />
            <div className="flex flex-col items-center gap-1">
              <p className="text-white text-xl font-bold">Compiling your timelapse video...</p>
              <p className="text-secondary text-sm">This usually takes a minute or two.</p>
            </div>
          </div>
        )}

        {compilationStatus === "ready" && (
          <div className={clsx(
            "flex flex-col items-start gap-6 sm:gap-8 w-full max-w-2xl",
            videoUrl && "md:max-w-5xl lg:max-w-7xl"
          )}>
            <h1 className="flex items-center gap-3 m-0 text-xl sm:text-3xl font-bold wrap-break-word">
              <Icon glyph="party" size={40} className="text-white shrink-0 w-8 h-8 sm:w-10 sm:h-10" />
              Your timelapse is complete!
            </h1>

            <div className={clsx(
              "flex flex-col gap-6 w-full",
              videoUrl && "md:flex-row md:items-start md:gap-8"
            )}>
              {videoUrl && (
                <video
                  src={videoUrl}
                  controls
                  className="w-full max-h-[50vh] object-contain md:w-5/12 md:shrink-0 md:sticky md:top-8 rounded-xl border border-slate"
                />
              )}

              <div className="flex flex-col gap-6 flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <StepMarker index={1} label="Details" state={step === "details" ? "current" : "done"} />
                  <div className="flex-1 h-px bg-slate" />
                  <StepMarker index={2} label="Hackatime" state={step === "hackatime" ? "current" : "upcoming"} />
                </div>

                {/*
                  Both steps live in the same grid cell - the column is then as tall as the tallest of the two, and
                  moving between them doesn't resize anything around it. The track is explicitly allowed to shrink
                  below its content, as an "auto" one would grow past the screen on narrow viewports.
                */}
                <div className="grid grid-cols-[minmax(0,1fr)]">
                  <div
                    inert={step !== "details"}
                    className={clsx(
                      "col-start-1 row-start-1 min-w-0 flex flex-col gap-6 transition-[translate,opacity] duration-300 ease-out",
                      step === "details" ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0"
                    )}
                  >
                    <TextInput
                      field={{ label: "Name", description: "Give your timelapse a title." }}
                      value={name}
                      onChange={setName}
                      placeholder="My awesome timelapse"
                      maxLength={60}
                    />

                    <TextInput
                      field={{ label: "Description", description: "An optional description for your timelapse." }}
                      value={description}
                      onChange={setDescription}
                      placeholder="What did you build?"
                      maxLength={280}
                    />

                    <div className="flex flex-col w-full">
                      <label className="font-bold">Visibility</label>
                      <p className="text-muted mb-2">Choose who can see your timelapse.</p>
                      <VisibilityPicker value={visibility} onChange={setVisibility} />
                    </div>

                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={handleVisibilitySelect}
                        disabled={!visibility || isPublishing || isDiscarding}
                        kind="primary"
                        className="w-full"
                      >
                        Continue
                      </Button>

                      <Button
                        onClick={handleDiscard}
                        disabled={isDiscarding || isPublishing}
                        kind="destructive"
                        className="w-full"
                      >
                        {isDiscarding ? "Discarding..." : "Discard"}
                      </Button>
                    </div>
                  </div>

                  <div
                    inert={step !== "hackatime"}
                    className={clsx(
                      "col-start-1 row-start-1 min-w-0 flex flex-col gap-6 transition-[translate,opacity] duration-300 ease-out",
                      step === "hackatime" ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
                    )}
                  >
                    <div className="flex flex-col w-full">
                      <label className="font-bold">Sync with Hackatime</label>
                      <p className="text-muted">
                        Pick the project your timelapsed time should be added to, or leave it unpicked to publish
                        without syncing.
                      </p>
                    </div>

                    <HackatimeProjectPicker
                      isActive={step === "hackatime"}
                      initialProject={hackatimeProject}
                      onChange={setHackatimeProject}
                      onLoadingChange={setIsLoadingHackatime}
                    />

                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={() => publish(hackatimeProject)}
                        disabled={isLoadingHackatime || isPublishing}
                        kind="primary"
                        className="w-full"
                      >
                        {
                          isPublishing ? "Publishing..." :
                          hackatimeProject ? "Publish & sync" :
                          "Publish"
                        }
                      </Button>

                      <Button
                        onClick={() => setStep("details")}
                        disabled={isPublishing}
                        icon="view-back"
                        className="w-full"
                      >
                        Back
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {editorOpen && storedSession && (
        <EditorModal
          token={storedSession.lookoutToken}
          apiBaseUrl={storedSession.lookoutApiBaseUrl}
          onDone={() => { setEditorOpen(false); setEditorDone(true); }}
        />
      )}

      <LoadingModal
        isOpen={isPublishing}
        title="Publishing"
        message="Publishing your timelapse..."
      />

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onClose={() => {
          if (compilationStatus === "failed") {
            router.push("/");
          }
        }}
      />
    </RootLayout>
  );
}
