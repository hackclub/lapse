import { Modal } from "./Modal";
import { Button } from "./Button";
import Icon from "@hackclub/icons";
import { IconGlyph } from "./util";
import clsx from "clsx";
import { useRouter } from "next/router";

export interface ErrorModalButton {
  label: string;
  onClick: () => void;
  kind?: "primary" | "secondary";
}

export function ErrorModal({
  isOpen,
  setIsOpen,
  title = "Woops!",
  message,
  icon = "important",
  buttons,
  onRetry,
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
  retryLabel?: string;
  className?: string;
}) {
  const router = useRouter();

  const defaultButtons: ErrorModalButton[] = [
    ...(
      onRetry ? [
        {
          label: retryLabel,
          onClick: onRetry,
          kind: "primary" as const
        }
      ] : []
    ),
    {
      label: "Close",
      onClick: () => {
        setIsOpen(false);
        router.back();
      },
      kind: "primary" as const
    }
  ];

  const finalButtons = buttons || defaultButtons;

  return (
    <Modal isOpen={isOpen} size="SMALL" className={clsx("min-w-[200px]", className)}>
      <div className="flex flex-col items-center p-8 text-center gap-4">
        <div className="flex items-center justify-center w-30 h-30 rounded-full bg-red/10">
          <Icon glyph={icon} size={64} />
        </div>

        <div className="flex flex-col">
          <h1 className="font-bold text-2xl">{title}</h1>
          <p className="max-w-md leading-relaxed">{message}</p>
        </div>

        <div className="flex flex-col gap-3 w-full">
          {
            finalButtons.map((button, index) => (
              <Button
                key={index}
                onClick={button.onClick}
                kind={button.kind || "secondary"}
                className="w-full"
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
