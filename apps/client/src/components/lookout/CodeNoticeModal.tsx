import { useState } from "react";

import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";

const DISMISS_KEY = "lapse:cache.codeNoticeDismissed";

/**
 * Whether the user has ticked "don't show this again" on the code notice. Read synchronously
 * (rather than via `useCache`) so a returning user never sees the modal flash before it hides.
 */
export function isCodeNoticeDismissed(): boolean {
  if (typeof window === "undefined")
    return false;

  try {
    return localStorage.getItem(DISMISS_KEY) === "true";
  }
  catch {
    return false;
  }
}

function dismissCodeNotice() {
  try {
    localStorage.setItem(DISMISS_KEY, "true");
  }
  catch {
    // Private browsing or a full quota - the notice just shows again next time.
  }
}

/**
 * Shown before every new recording: review can't make sense of a timelapse of an editor, so code
 * belongs in Hackatime's editor extensions instead. Dismissable, but never silently skipped
 * unless the user asked for that.
 */
export function CodeNoticeModal({ onAcknowledge, onClose }: {
  onAcknowledge: () => void;
  onClose: () => void;
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  function handleAcknowledge() {
    if (dontShowAgain)
      dismissCodeNotice();

    onAcknowledge();
  }

  return (
    <Modal isOpen>
      <ModalHeader
        image="/images/orpheus-cool.png"
        showCloseButton={true}
        onClose={onClose}
        title="Do NOT use Lapse for code!"
        description="Lapse is for work a normal editor extension can't track"
        shortDescription="Lapse is for work extensions can't track"
      />
      <ModalContent>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 leading-relaxed">
            <p>
              Use Lapse for things like soldering, CAD, and art: things you can&apos;t track from your
              code editor.
            </p>
            <p>
              <strong>If you&apos;re writing code, track it with Hackatime instead!</strong>
            </p>
            <p>
              <strong>Timelapses of code won&apos;t be accepted starting today.</strong>
            </p>
            <p className="text-muted text-sm">
              Ask us in{" "}
              <a
                href="https://hackclub.enterprise.slack.com/archives/C09NVLWU61E"
                target="_blank"
                rel="noopener noreferrer"
                className="text-red underline"
              >
                #lapse-help
              </a>{" "}
              if you have any questions!
            </p>
          </div>

          <Checkbox
            label="Don't show this again"
            description={null}
            checked={dontShowAgain}
            onChange={setDontShowAgain}
            inline
          />

          <Button kind="primary" onClick={handleAcknowledge}>
            Got it
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
}
