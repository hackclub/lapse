import { Modal, ModalHeader } from "./Modal";
import Icon from "@hackclub/icons";

export function LoadingModal({
  isOpen,
  title = "Processing...",
  message,
  progress,
  className
}: {
  isOpen: boolean;
  title?: string;
  message?: string;
  progress?: number;
  className?: string;
}) {
  return (
    <Modal isOpen={isOpen} className={className}>
      <ModalHeader icon="clock-fill" title={title}>
        <div className="flex flex-col gap-4 w-full">
          {message && (
            <p className="text-sm text-muted">{message}</p>
          )}

          <div className="flex items-center gap-2 mb-4 w-full">
            <div className="animate-spin">
              <Icon glyph="clock" size={20} />
            </div>

            {progress !== undefined && (
              <span className="text-xs text-muted">{Math.round(progress)}%</span>
            )}

            <div className="w-full bg-smoke rounded-full h-2 overflow-hidden">
              {progress !== undefined ? (
                <div
                  className="bg-blue h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              ) : (
                <div
                  className="bg-blue h-2 rounded-full animate-pulse"
                  style={{
                    width: "30%",
                    animation: "indeterminate 2s ease-in-out infinite"
                  }}
                />
              )}
            </div>
          </div>

          <style jsx>{`
            @keyframes indeterminate {
              0% { transform: translateX(-100%); }
              50% { transform: translateX(300%); }
              100% { transform: translateX(-100%); }
            }
          `}</style>
        </div>
      </ModalHeader>
    </Modal>
  );
}
