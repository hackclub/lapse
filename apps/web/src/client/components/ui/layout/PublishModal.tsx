import Icon from "@hackclub/icons";
import clsx from "clsx";

import { Modal, ModalHeader, ModalContent } from "../Modal";
import { IconGlyph } from "../util";
import type { TimelapseVisibility } from "@/client/api";

function VisibilityOption({
    icon,
    title,
    description,
    onClick,
    position
}: {
    icon: IconGlyph;
    title: string;
    description: string;
    onClick: () => void;
    position: "first" | "second";
}) {
    return (
        <button
            onClick={onClick}
            className={clsx(
                "flex items-center gap-4 p-4 w-full sm:w-1/2 cursor-pointer transition-colors hover:bg-darkless",
                position === "first" && "border-b sm:border-b-0 sm:border-r border-slate"
            )}
        >
            <Icon glyph={icon} size={48} className="flex-shrink-0" />
            <div className="flex flex-col text-left pr-2">
                <span className="font-bold">{title}</span>
                <span className="text-muted text-sm">{description}</span>
            </div>
        </button>
    );
}

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
                <div className="flex flex-col sm:flex-row w-full border border-slate rounded-lg overflow-hidden">
                    <VisibilityOption
                        icon="explore"
                        title="Public"
                        description="Make your timelapse visible to the world! Recommended!"
                        onClick={() => onSelect("PUBLIC")}
                        position="first"
                    />
                    <VisibilityOption
                        icon="private-fill"
                        title="Unlisted"
                        description="Only staff and people with the link will be able to access your timelapse."
                        onClick={() => onSelect("UNLISTED")}
                        position="second"
                    />
                </div>
            </ModalContent>
        </Modal>
    );
}
