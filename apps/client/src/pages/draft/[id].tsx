import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import type { DraftTimelapse, TimelapseVisibility } from "@hackclub/lapse-api";
import Icon from "@hackclub/icons";
import posthog from "posthog-js";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { deviceStorage } from "@/deviceStorage";

import { useDecryptedThumbnail } from "@/components/entity/ThumbnailImage";
import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { LoadingModal } from "@/components/layout/LoadingModal";
import { ErrorModal } from "@/components/layout/ErrorModal";
import { VisibilityPicker } from "@/components/layout/VisibilityPicker";
import { HackatimeSelectModal } from "@/components/layout/HackatimeSelectModal";

/**
 * Recovery page for legacy ("pre-Lookout") draft timelapses.
 *
 * The legacy recording pipeline (canvas/MediaRecorder capture, client-side editing) was removed when we migrated
 * to Lookout. This page exists so that drafts created with that pipeline can still be *published* - it deliberately
 * does NOT let the user continue recording or edit the footage. The encrypted sessions are decrypted and re-encoded
 * server-side via the existing realize job; the client only needs to hand over the device key.
 */
export default function Page() {
  const router = useRouter();
  useAuth(true);

  const rawId = router.query.id as string | undefined;
  const draftId = rawId && rawId !== "undefined" ? rawId : undefined;

  const [draft, setDraft] = useState<DraftTimelapse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Decrypt the (client-encrypted) preview thumbnail so the user can recognise the draft. `missingKey` is set when
  // the draft was recorded on a device whose key isn't available locally - we can't publish it from here.
  const { thumbnail, missingKey: thumbMissingKey } = useDecryptedThumbnail({
    id: draft?.id ?? "",
    url: draft?.previewThumbnail,
    iv: draft?.iv ?? "",
    deviceId: draft?.deviceId,
    mimeType: "image/webp",
    enabled: !!draft,
  });
  // The publish path re-checks for the device key and can flip this on too.
  const [missingKeyAtPublish, setMissingKeyAtPublish] = useState(false);
  const missingKey = thumbMissingKey || missingKeyAtPublish;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<TimelapseVisibility | null>(null);

  const [hackatimeModalOpen, setHackatimeModalOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const load = useCallback(async () => {
    if (!draftId) return;

    setLoading(true);

    try {
      const res = await api.draftTimelapse.query({ id: draftId });
      if (!res.ok) {
        setError(res.message);
        return;
      }

      const fetched = res.data.timelapse;

      // If the draft is already being published, there's an associated (processing) timelapse - send the user there.
      if (fetched.associatedTimelapseId) {
        router.replace(`/timelapse/${fetched.associatedTimelapseId}`);
        return;
      }

      setDraft(fetched);
      setName(fetched.name ?? "");
      setDescription(fetched.description ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load draft");
    } finally {
      setLoading(false);
    }
  }, [draftId, router]);

  useEffect(() => {
    if (!router.isReady) return;
    load();
  }, [router.isReady, load]);

  function handlePublishClick() {
    if (!visibility) return;
    setHackatimeModalOpen(true);
  }

  async function publish(hackatimeProject: string | null) {
    setHackatimeModalOpen(false);

    if (!draft || !visibility) return;

    setIsPublishing(true);

    try {
      const device = await deviceStorage.getDevice(draft.deviceId);
      if (!device) {
        setMissingKeyAtPublish(true);
        setError("This draft was recorded on a different device, so it can't be published from here.");
        return;
      }

      // Persist the metadata edits the user made before kicking off the (irreversible) publish. The server requires
      // a title of at least 2 characters, so anything shorter is treated as "no title" (the server generates one).
      const trimmedName = name.trim();
      const updateRes = await api.draftTimelapse.update({
        id: draft.id,
        changes: {
          name: trimmedName.length >= 2 ? trimmedName : undefined,
          description: description.trim(),
          editList: draft.editList,
        },
      });

      if (!updateRes.ok) {
        setError(updateRes.message);
        return;
      }

      const res = await api.timelapse.publish({
        id: draft.id,
        visibility,
        deviceKey: device.passkey,
        ...(hackatimeProject ? { hackatimeProject } : {}),
      });

      if (!res.ok) {
        setError(res.message);
        return;
      }

      posthog.capture("legacy_timelapse_published", {
        timelapseId: res.data.timelapse.id,
        visibility,
        hackatimeProject,
      });

      location.href = `/timelapse/${res.data.timelapse.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish timelapse");
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleDiscard() {
    if (!draft) return;

    if (!window.confirm("Are you sure you want to discard this draft? This action cannot be undone."))
      return;

    setIsDiscarding(true);

    try {
      const res = await api.draftTimelapse.delete({ id: draft.id });
      if (!res.ok) {
        setError(res.message);
        setIsDiscarding(false);
        return;
      }

      posthog.capture("legacy_timelapse_discarded", { draftId: draft.id });
      router.push(`/user/@${draft.owner.handle}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to discard draft");
      setIsDiscarding(false);
    }
  }

  if (!draftId || loading) {
    return (
      <RootLayout>
        <LoadingModal isOpen title="Loading" message="Loading draft..." />
      </RootLayout>
    );
  }

  return (
    <RootLayout>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
        {draft && (
          <div className="flex flex-col gap-6 w-full max-w-2xl">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold">Publish your draft</h1>
              <p className="text-secondary">
                This timelapse was recorded with an older version of Lapse. You can&apos;t keep recording it, but you can
                still publish what you&apos;ve already captured.
              </p>
            </div>

            <div className="w-full aspect-video rounded-xl border border-slate overflow-hidden bg-darker flex items-center justify-center">
              {thumbnail ? (
                <img src={thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <Icon glyph={missingKey ? "private" : "clock-fill"} size={48} className="text-muted" />
              )}
            </div>

            {missingKey ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1 rounded-xl border border-slate p-4">
                  <span className="font-bold">Recorded on another device</span>
                  <p className="text-secondary text-sm">
                    The key needed to decrypt this draft lives on the device it was recorded on. Open Lapse on that
                    device to publish it. You can still discard it from here.
                  </p>
                </div>

                <Button
                  onClick={handleDiscard}
                  disabled={isDiscarding}
                  kind="destructive"
                  className="w-full"
                >
                  {isDiscarding ? "Discarding..." : "Discard"}
                </Button>
              </div>
            ) : (
              <>
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
                    onClick={handlePublishClick}
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
              </>
            )}
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
        onClose={() => {}}
      />
    </RootLayout>
  );
}
