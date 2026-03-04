import { api } from "@/api";
import { ErrorModal } from "@/components/layout/ErrorModal";
import RootLayout from "@/components/layout/RootLayout";
import { useApiCall } from "@/hooks/useApiCall";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";
import { DraftTimelapse } from "@hackclub/lapse-api";
import { useRouter } from "next/router";
import { useState } from "react";

export default function Page() {
  const router = useRouter();

  const [draft, setDraft] = useState<DraftTimelapse | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [errorIsCritical, setErrorIsCritical] = useState(false);

  useAsyncEffect(async () => {
    if (!router.isReady)
      return;

    try {
      const { id } = router.query;

      if (typeof id !== "string") {
        setError("Invalid timelapse ID provided");
        setErrorIsCritical(true);
        return;
      }

      console.log("([id].tsx) querying draft...");
      const res = await api.draftTimelapse.query({ id });
      if (!res.ok) {
        console.error("([id].tsx) couldn't fetch that draft!", res);
        setError(res.message);
        setErrorIsCritical(true);
        return;
      }

      console.log("([id].tsx) timelapse fetched!", res.data.timelapse);
      setDraft(res.data.timelapse);
    }
    catch (apiErr) {
      console.error("([id].tsx) error loading timelapse:", apiErr);
      setError(apiErr instanceof Error ? apiErr.message : "An unknown error occurred while loading the timelapse");
      setErrorIsCritical(true);
    }
  }, [router, router.isReady]);

  function getVideoAtTime(t: number) {
    if (!draft)
      throw new Error("Attempted to call getVideoAtTime without a draft being loaded.");

    
  }

  return (
    <RootLayout showHeader={false}>
      <main>

      </main>

      <ErrorModal
        isOpen={!!error}
        setIsOpen={(open) => !open && setError(null)}
        message={error || ""}
        onClose={errorIsCritical ? () => router.back() : undefined}
      />
    </RootLayout>
  );
}