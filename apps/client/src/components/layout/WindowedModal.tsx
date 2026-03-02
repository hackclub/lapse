import { PropsWithChildren } from "react";

import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import type { IconGlyph } from "@/common";

export function WindowedModal({ children, title, description, shortDescription, icon, isOpen, setIsOpen }: PropsWithChildren<{
  isOpen: boolean;
  setIsOpen: (x: boolean) => void;
  icon: IconGlyph;
  title: string;
  description: string;
  shortDescription?: string;
}>) {
  shortDescription ??= description;

  return (
    <Modal isOpen={isOpen}>
      <ModalHeader
        icon={icon}
        title={title}
        description={description}
        shortDescription={shortDescription}
        showCloseButton={true}
        onClose={() => setIsOpen(false)}
      />
      <ModalContent>
        {children}
      </ModalContent>
    </Modal>
  );
}
