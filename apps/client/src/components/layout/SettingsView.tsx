import { useState } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";

import type { IconGlyph } from "@/common";
import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { ConnectedServicesTab } from "@/components/layout/settings/ConnectedServicesTab";
import { DeveloperAppsTab } from "@/components/layout/settings/DeveloperAppsTab";
import { DevicesTab } from "@/components/layout/settings/DevicesTab";
import { AdminTab } from "@/components/layout/settings/AdminTab";
import { SignOutModal } from "@/components/layout/SignOutModal";
import { useAdminView } from "@/hooks/useAdminView";

type SettingsTab = "services" | "apps" | "devices" | "admin";

const tabs: { id: SettingsTab; label: string; icon: IconGlyph }[] = [
  { id: "services", label: "Connected Services", icon: "web" },
  { id: "apps", label: "Developer Apps", icon: "code" },
  { id: "devices", label: "Devices", icon: "laptop" },
  { id: "admin", label: "Admin", icon: "admin-badge" },
];

export function SettingsView({ isOpen, setIsOpen }: {
  isOpen: boolean,
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("services");
  const [isSignOutOpen, setIsSignOutOpen] = useState(false);
  const { isAdmin } = useAdminView();

  return (
    <>
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
            {tabs.filter(tab => tab.id !== "admin" || isAdmin).map(tab => (
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

            <button
              onClick={() => setIsSignOutOpen(true)}
              className="flex items-center gap-3 px-4 py-2.5 mt-auto text-base rounded-lg cursor-pointer transition-colors text-left text-muted hover:text-red hover:bg-darkless"
            >
              <Icon glyph="door-leave" size={20} />
              Sign out
            </button>
          </nav>

          <ModalContent className="flex-1 !py-8">
            {activeTab === "services" && <ConnectedServicesTab isVisible={isOpen} />}
            {activeTab === "apps" && <DeveloperAppsTab isVisible={isOpen} />}
            {activeTab === "devices" && <DevicesTab isVisible={isOpen} />}
            {activeTab === "admin" && isAdmin && <AdminTab />}
          </ModalContent>
        </div>
      </Modal>

      <SignOutModal
        isOpen={isSignOutOpen}
        setIsOpen={setIsSignOutOpen}
      />
    </>
  );
}
