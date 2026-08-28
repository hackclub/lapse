import { useEffect, useState } from "react";
import { useRouter } from "next/router";

import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { Button } from "@/components/ui/Button";
import { RELINK_SESSION_KEY, useHackatimeRelink } from "@/hooks/useHackatimeRelink";

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
    sessionStorage.removeItem(RELINK_SESSION_KEY);
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
          Hackatime changed what it lets Lapse read, so we can&apos;t load your project list anymore. Your
          timelapses still sync - the picker just shows up empty, as though you had no projects.
        </p>

        <p className="text-muted">
          Signing in again fixes it. It takes a couple of seconds and brings you right back here.
        </p>

        <Button kind="primary" onClick={reconnect} className="w-full">
          Reconnect Hackatime
        </Button>
      </ModalContent>
    </Modal>
  );
}
