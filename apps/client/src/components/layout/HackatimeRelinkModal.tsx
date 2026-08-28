import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { Button } from "@/components/ui/Button";
import { useHackatimeRelink } from "@/hooks/useHackatimeRelink";

const AUTH_ROUTE = "/auth";
const DISMISSED_SESSION_KEY = "lapse:hackatimeRelinkDismissed";

/**
 * Raised once per session for users whose Hackatime authorization predates the `read` scope. Dismissing it leaves
 * `HackatimeRelinkBanner` in place, so the way to fix it stays reachable without asking twice.
 */
export function HackatimeRelinkModal() {
  const router = useRouter();
  const needsRelink = useHackatimeRelink();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISSED_SESSION_KEY) === "true");
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISSED_SESSION_KEY, "true");
    setDismissed(true);
  }

  function reconnect() {
    router.push(`${AUTH_ROUTE}?force=1&redirect=${encodeURIComponent(router.asPath)}`);
  }

  const isOpen = needsRelink && !dismissed && router.pathname !== AUTH_ROUTE;

  return (
    <Modal isOpen={isOpen} size="SMALL">
      <ModalHeader
        icon="clock"
        title="Reconnect Hackatime"
        description="Hackatime needs your permission again"
        showCloseButton
        onClose={dismiss}
      />

      <ModalContent className="gap-4 text-base">
        <p>
          Your timelapses still sync! The picker shows up empty, as if you had no projects.
        </p>

        <p className="text-muted">
          Reconnecting Hackatime fixes this issue. It only takes a few seconds.
        </p>

        <Button kind="primary" onClick={reconnect} className="w-full">
          Reconnect Hackatime
        </Button>
      </ModalContent>
    </Modal>
  );
}
