import { Modal, ModalHeader, ModalContent } from "../Modal";
import { VisibilityPicker } from "../VisibilityPicker";
import type { TimelapseVisibility } from "@/client/api";

export function PublishModal({
  isOpen,
  setIsOpen,
  onSelect
}: {
  isOpen: boolean;
  setIsOpen: (x: boolean) => void;
  onSelect: (visibility: TimelapseVisibility) => void;
}) {
  return (
    <Modal isOpen={isOpen} size="REGULAR">
      <ModalHeader
        icon="send-fill"
        title="Publish Timelapse"
        description="Choose who can see your timelapse"
        showCloseButton={true}
        onClose={() => setIsOpen(false)}
      />
      <ModalContent>
        <p className="text-muted mb-4">This will decrypt your timelapse - making it undeletable. You can change the visibility later, though!</p>
        <VisibilityPicker
          value={null}
          onChange={onSelect}
        />
      </ModalContent>
    </Modal>
  );
}
