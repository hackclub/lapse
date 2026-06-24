import { useState } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";

import type { IconGlyph } from "@/common";
import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { ConnectedServicesTab } from "@/components/layout/settings/ConnectedServicesTab";
import { DeveloperAppsTab } from "@/components/layout/settings/DeveloperAppsTab";
import { DevicesTab } from "@/components/layout/settings/DevicesTab";

type SettingsTab = "services" | "apps" | "devices";

const tabs: { id: SettingsTab; label: string; icon: IconGlyph }[] = [
  { id: "services", label: "Connected Services", icon: "web" },
  { id: "apps", label: "Developer Apps", icon: "code" },
  { id: "devices", label: "Devices", icon: "laptop" },
];

export function SettingsView({ isOpen, setIsOpen }: {
  isOpen: boolean,
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("services");

  return (
    <Modal isOpen={isOpen} className="sm:[&>section]:min-h-[70vh]">
      <ModalHeader
        icon="settings"
        title="Settings"
        description="Manage your connected services, apps, and devices"
        showCloseButton
        onClose={() => setIsOpen(false)}
      />

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex flex-col gap-1 p-3 border-r border-black min-w-48 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                "flex items-center gap-3 px-4 py-2.5 text-base rounded-lg cursor-pointer transition-colors text-left",
                activeTab === tab.id
                  ? "bg-red text-white"
                  : "text-muted hover:text-white hover:bg-darkless"
              )}
            >
              <Icon glyph={tab.icon} size={20} />
              {tab.label}
            </button>
          ))}
        </nav>

        <ModalContent className="flex-1 !py-8">
          {activeTab === "services" && <ConnectedServicesTab isVisible={isOpen} />}
          {activeTab === "apps" && <DeveloperAppsTab isVisible={isOpen} />}
          {activeTab === "devices" && <DevicesTab isVisible={isOpen} />}
        </ModalContent>
      </div>
    </Modal>
  );
}
