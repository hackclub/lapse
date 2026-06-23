import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { TimelapseVisibility } from "@hackclub/lapse-api";
import posthog from "posthog-js";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { useInterval } from "@/hooks/useInterval";

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

  const timelapseId = router.query.id as string | undefined;

  const [compilationStatus, setCompilationStatus] = useState<CompilationStatus>("waiting");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<TimelapseVisibility | null>(null);

  const [hackatimeModalOpen, setHackatimeModalOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useInterval(async () => {
    if (!timelapseId || compilationStatus !== "waiting") return;

    try {
      const res = await api.timelapse.pollLookoutStatus({ id: timelapseId });
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
    if (!timelapseId || !visibility) return;

    setIsPublishing(true);

    try {
      const res = await api.timelapse.publishFromLookout({
        id: timelapseId,
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

      posthog.capture("timelapse_published_lookout", { timelapseId, hackatimeProject });
      location.href = `/timelapse/${timelapseId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish timelapse");
      setIsPublishing(false);
    }
  }

  if (!timelapseId) {
    return (
      <RootLayout>
        <LoadingModal isOpen title="Loading" message="Loading timelapse..." />
      </RootLayout>
    );
  }

  return (
    <RootLayout>
      <div className="max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-2">Publish Timelapse</h1>

        {compilationStatus === "waiting" && (
          <div className="flex flex-col items-center gap-4 py-16">
            <div className="w-8 h-8 border-3 border-red border-t-transparent rounded-full animate-spin" />
            <p className="text-muted">Compiling your timelapse video...</p>
            <p className="text-secondary text-sm">This usually takes a minute or two.</p>
          </div>
        )}

        {compilationStatus === "ready" && (
          <div className="flex flex-col gap-6 mt-6">
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

            <div className="flex flex-col gap-2">
              <label className="font-bold">Visibility</label>
              <p className="text-muted mb-1">Choose who can see your timelapse.</p>
              <VisibilityPicker value={visibility} onChange={setVisibility} />
            </div>

            <Button
              onClick={handleVisibilitySelect}
              disabled={!visibility || isPublishing}
              kind="primary"
              className="w-full"
            >
              {isPublishing ? "Publishing..." : "Publish"}
            </Button>
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
