import { useState } from "react";

import { WindowedModal } from "@/components/layout/WindowedModal";
import { HackatimeProjectPicker } from "@/components/entity/HackatimeProjectPicker";
import { Button } from "@/components/ui/Button";

export function HackatimeSelectModal({ isOpen, setIsOpen, onAccept, onError }: {
  isOpen: boolean;
  setIsOpen: (x: boolean) => void;
  onAccept: (hackatimeProjectName: string | null) => void;
  onError: (message: string) => void;
}) {
  const [chosenProject, setChosenProject] = useState<string | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  function handleClose() {
    onAccept(null);
    setIsOpen(false);
  }

  function handleConfirm() {
    if (!chosenProject)
      return;

    try {
      setIsPublishing(true);
      onAccept(chosenProject);
      setIsOpen(false);
    }
    catch (error) {
      onError(error instanceof Error ? error.message : "An error occurred while publishing.");
    }
    finally {
      setIsPublishing(false);
    }
  }

  return (
    <WindowedModal
      icon="history"
      title="Sync with Hackatime"
      description="Synchronize timelapsed time to a Hackatime project"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="flex flex-col gap-6">
        <HackatimeProjectPicker
          isActive={isOpen}
          onChange={setChosenProject}
          onLoadingChange={setIsLoadingProjects}
        />

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <Button
            disabled={isPublishing}
            className="w-full"
            onClick={handleClose}
          >
            Sync later
          </Button>

          <Button
            onClick={handleConfirm}
            disabled={isPublishing || isLoadingProjects || !chosenProject}
            kind="primary"
            className="w-full"
          >
            {isPublishing ? "Syncing..." : "Sync with Hackatime"}
          </Button>
        </div>
      </div>
    </WindowedModal>
  );
}
