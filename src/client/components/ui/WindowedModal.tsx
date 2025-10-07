import { PropsWithChildren } from "react";
import { Modal, ModalHeader, ModalContent } from "./Modal";
import { IconGlyph } from "./util";

export function WindowedModal({
  children,
  title,
  description,
  icon,
  isOpen,
  setIsOpen
}: PropsWithChildren<{
  isOpen: boolean;
  setIsOpen: (x: boolean) => void;
  icon: IconGlyph;
  title: string;
  description: string;
}>) {
  return (
    <Modal isOpen={isOpen}>
      <ModalHeader
        icon={icon}
        title={title}
        description={description}
        showCloseButton={true}
        onClose={() => setIsOpen(false)}
      />
      <ModalContent>
        {children}
      </ModalContent>
    </Modal>
  );
}
