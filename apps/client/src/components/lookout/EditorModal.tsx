import { useEffect } from "react";
import { TimelapseEditor, setAccentColor } from "@lookout/react";

import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";

// Lapse's brand red (mirrors --color-red in globals.css). Applied to the Lookout SDK's
// document-root accent variables so the editor matches the rest of the app.
const LAPSE_ACCENT = "#ec3750";

/**
 * The Lookout cut/edit step, wrapped in a Lapse-styled modal. Used right after a
 * recording stops, and again by the publish page to resume an interrupted edit while
 * the session's edit hold is still live.
 *
 * `onDone` fires when the user is finished with the editor — cuts applied or the
 * editor dismissed. Either way the session publishes (the edit hold is a lease, and
 * leaving the editor is the decision to publish), so callers should continue to the
 * publish flow.
 */
export function EditorModal({ token, apiBaseUrl, onDone }: {
  token: string;
  apiBaseUrl: string;
  onDone: () => void;
}) {
  // The editor is the only SDK-rendered surface in Lapse, so the accent lives here
  // rather than on LookoutProvider. Set on the document root (the editor portals to
  // <body>), restored on unmount so the accent never leaks past the editor.
  useEffect(() => {
    setAccentColor(LAPSE_ACCENT, null);
    return () => setAccentColor(null, null);
  }, []);

  return (
    <Modal isOpen size="FULL">
      <ModalHeader
        icon="edit"
        title="Edit your timelapse"
        description="Trim out any parts you don't want to keep."
        showCloseButton
        onClose={onDone}
      />
      <ModalContent className="p-0 flex-1 min-h-0">
        <div className="h-[70vh] min-h-125">
          <TimelapseEditor
            token={token}
            apiBaseUrl={apiBaseUrl}
            onApplied={onDone}
            onCancel={onDone}
          />
        </div>
      </ModalContent>
    </Modal>
  );
}
