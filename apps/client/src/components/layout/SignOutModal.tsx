import { useEffect, useState } from "react";
import Icon from "@hackclub/icons";

import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { Button } from "@/components/ui/Button";
import { getStoredSessions } from "@/components/lookout/sessions";
import { useAuth } from "@/hooks/useAuth";

export function SignOutModal({ isOpen, setIsOpen }: {
  isOpen: boolean;
  setIsOpen: (x: boolean) => void;
}) {
  const auth = useAuth(false);

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hasUnfinishedRecordings, setHasUnfinishedRecordings] = useState(false);

  useEffect(() => {
    if (!isOpen)
      return;

    setFailed(false);
    setHasUnfinishedRecordings(getStoredSessions().length > 0);
  }, [isOpen]);

  async function signOut(skipRevocation: boolean) {
    setIsSigningOut(true);
    setFailed(false);

    try {
      await auth.signOut({ skipRevocation });
    }
    catch (err) {
      console.error("(SignOutModal.tsx) could not sign out!", err);
      setFailed(true);
      setIsSigningOut(false);
    }
  }

  function close() {
    if (!isSigningOut)
      setIsOpen(false);
  }

  return (
    <Modal isOpen={isOpen} size="SMALL">
      <ModalHeader
        icon="door-leave"
        title="Sign out?"
        description={auth.currentUser ? `You're signed in as @${auth.currentUser.handle}.` : undefined}
        showCloseButton
        onClose={close}
      />

      <ModalContent className="gap-4">
        <p>
          You&apos;ll be signed out on this device only. Your timelapses and drafts stay safe in your account, and
          you can pick up right where you left off by signing back in.
        </p>

        {
          hasUnfinishedRecordings && (
            <div className="flex gap-3 p-4 rounded-lg border border-black bg-darkless">
              <Icon glyph="important" size={24} className="shrink-0" />
              <p className="text-sm">
                You have a recording on this device that hasn&apos;t been published yet. It&apos;s saved to your
                account - sign back in to publish it.
              </p>
            </div>
          )
        }

        {
          failed && (
            <div className="flex gap-3 p-4 rounded-lg border border-red text-red">
              <Icon glyph="important" size={24} className="shrink-0" />
              <p className="text-sm">
                We couldn&apos;t reach Lapse to end your session. You can still sign out on this device - your
                session will then stay valid on our end until it expires.
              </p>
            </div>
          )
        }

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button onClick={close} disabled={isSigningOut} className="flex-1">
            Cancel
          </Button>

          {
            failed ? (
              <Button
                kind="destructive"
                icon="door-leave"
                onClick={() => signOut(true)}
                disabled={isSigningOut}
                className="flex-1"
              >
                Sign out anyway
              </Button>
            ) : (
              <Button
                kind="primary"
                icon="door-leave"
                onClick={() => signOut(false)}
                disabled={isSigningOut}
                className="flex-1"
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </Button>
            )
          }
        </div>
      </ModalContent>
    </Modal>
  );
}
