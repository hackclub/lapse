import { useEffect, useState } from "react";
import Icon from "@hackclub/icons";
import { formatDuration } from "@hackclub/lapse-shared";
import type { HackatimeProject } from "@hackclub/lapse-api";

import { api } from "@/api";
import { WindowedModal } from "@/components/layout/WindowedModal";
import { DropdownInput } from "@/components/ui/DropdownInput";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { InputField } from "@/components/ui/InputField";

export function HackatimeSelectModal({ isOpen, setIsOpen, onAccept, onError }: {
  isOpen: boolean;
  setIsOpen: (x: boolean) => void;
  onAccept: (hackatimeProjectName: string | null) => void;
  onError: (message: string) => void;
}) {
  const [hackatimeProject, setHackatimeProject] = useState("");
  const [hackatimeProjects, setHackatimeProjects] = useState<HackatimeProject[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const isPublishDisabled = isPublishing;

  useEffect(() => {
    if (!isOpen)
      return;

    setHackatimeProject("");
    setIsLoadingProjects(true);

    api.hackatime.allProjects({})
      .then(res => setHackatimeProjects(res.ok ? res.data.projects : []))
      .catch(() => setHackatimeProjects([]))
      .finally(() => setIsLoadingProjects(false));
  }, [isOpen]);

  async function handleConfirmPublish() {
    try {
      setIsPublishing(true);
      onAccept(hackatimeProject.trim() || null);
      setIsOpen(false);
      setHackatimeProject("");
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
      description="Import your timelapse snapshots to Hackatime as heartbeats. This can only be done once per timelapse."
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow/10 border border-yellow/20">
          <Icon glyph="important" size={24} className="text-yellow shrink-0" />
          <div>
            <p className="font-bold text-yellow">One-time sync</p>
            <p className="text-smoke">You can only sync a timelapse with Hackatime once. Make sure you choose the correct project name.</p>
          </div>
        </div>

        {isLoadingProjects ? (
          <>
            <InputField
              label="Project Name"
              description="Loading projects - hold on..."
            >
              <Skeleton className="w-full h-10.5" />
            </InputField>
          </>
        ) : isOpen && (
          <>
            <DropdownInput
              label="Project Name"
              description="Select an existing Hackatime project or type to create a new one."
              value={hackatimeProject}
              onChange={setHackatimeProject}
              options={
                hackatimeProjects.map(project => ({
                  value: project.name,
                  searchLabel: project.name,
                  label: (
                    <div className="flex justify-between w-full">
                      <span>{project.name}</span>
                      <span className="text-secondary">{formatDuration(project.totalSeconds)}</span>
                    </div>
                  )
                }))
              }
              allowUserCustom
            />
          </>
        )}

        <div className="flex gap-3">
          <Button onClick={handleConfirmPublish} disabled={isPublishDisabled || isLoadingProjects} kind="primary" className="w-full">
            {isPublishing ? "Publishing..." : "Sync with Hackatime"}
          </Button>

          <Button
            disabled={isPublishDisabled}
            className="w-full"
            onClick={() => {
              onAccept(null);
              setIsOpen(false);
              setHackatimeProject("");
            }}
          >
            Sync later
          </Button>
        </div>
      </div>
    </WindowedModal>
  );
}
