import Icon from "@hackclub/icons";
import clsx from "clsx";

import { Modal } from "./Modal";
import { Button } from "./Button";
import { IconGlyph } from "./util";
import { LogViewer } from "./LogViewer";

export interface ErrorModalButton {
  label: string;
  onClick: () => void;
  kind?: "primary" | "regular";
}

export function ErrorModal({
  isOpen,
  setIsOpen,
  title = "Woops!",
  message,
  icon = "important",
  buttons,
  onRetry,
  onClose,
  retryLabel = "Try Again",
  className
}: {
  isOpen: boolean;
  setIsOpen: (x: boolean) => void;
  title?: string;
  message: string;
  icon?: IconGlyph;
  buttons?: ErrorModalButton[];
  onRetry?: () => void;
  onClose?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  onClose ??= () => {
    setIsOpen(false);
  };

  const defaultButtons: ErrorModalButton[] = [
    ...(
      onRetry ? [
        {
          label: retryLabel,
          onClick: onRetry,
          kind: "regular" as const
        }
      ] : []
    ),
    {
      label: "Close",
      onClick: onClose,
      kind: "regular" as const
    }
  ];

  const finalButtons = buttons || defaultButtons;

  return (
    <Modal isOpen={isOpen} size="FULL" className={clsx("!p-4 sm:!p-12 lg:!p-24", className)}>
      <div className="flex flex-col p-6 gap-4 overflow-visible">
        <div className="flex flex-row items-center gap-3">
          <Icon glyph={icon} size={32} className="text-red shrink-0" />
          <div className="flex flex-col">
            <h1 className="font-bold text-base">{title}</h1>
            <p className="text-sm text-muted leading-relaxed">{message}</p>
          </div>
        </div>

        <LogViewer className="w-full" />

        <div className="flex flex-row gap-3">
          {
            finalButtons.map((button, index) => (
              <Button
                key={index}
                onClick={button.onClick}
                kind={button.kind || "regular"}
                className="flex-1"
              >
                {button.label}
              </Button>
            ))
          }
        </div>
      </div>
    </Modal>
  );
}
