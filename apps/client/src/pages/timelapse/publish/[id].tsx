import { useState } from "react";
import { useRouter } from "next/router";
import type { TimelapseVisibility } from "@hackclub/lapse-api";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { useInterval } from "@/hooks/useInterval";
import { removeStoredSession } from "@/components/lookout/sessions";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { VisibilityPicker } from "@/components/layout/VisibilityPicker";
import { HackatimeSelectModal } from "@/components/layout/HackatimeSelectModal";

type CompilationStatus = "waiting" | "ready" | "failed";

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

  const [hackatimeModalOpen, setHackatimeModalOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInterval(async () => {
    if (!draftId || compilationStatus !== "waiting") return;

    try {
      const res = await api.timelapse.pollLookoutStatus({ draftId });
      if (!res.ok) {
        setError(res.message);
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
  }, 3000);

  function handleVisibilitySelect() {
    if (!visibility) return;
    setHackatimeModalOpen(true);
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

  if (!draftId) {
    return (
      <RootLayout>
        <LoadingModal isOpen title="Loading" message="Loading timelapse..." />
      </RootLayout>
    );
  }

  return (
    <RootLayout>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
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
          <div className="flex flex-col gap-6 w-full max-w-2xl">
            {videoUrl && (
              <video
                src={videoUrl}
                controls
                className="w-full rounded-xl border border-slate"
              />
            )}

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
                {isPublishing ? "Publishing..." : "Publish"}
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
        )}
      </div>

      <HackatimeSelectModal
        isOpen={hackatimeModalOpen}
        setIsOpen={setHackatimeModalOpen}
        onAccept={publish}
        onError={setError}
      />

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
