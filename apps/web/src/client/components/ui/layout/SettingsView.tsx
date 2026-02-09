import { useEffect, useState } from "react";
import Icon from "@hackclub/icons";

import type { KnownDevice } from "@/server/routers/api/user";
import type { Timelapse } from "@/server/routers/api/timelapse";

import { trpc } from "@/client/trpc";
import { deviceStorage, LocalDevice } from "@/client/deviceStorage";
import { useAuth } from "@/client/hooks/useAuth";

import { WindowedModal } from "@/client/components/ui/WindowedModal";
import { Button } from "@/client/components/ui/Button";
import { PasskeyModal } from "@/client/components/ui/PasskeyModal";
import { ErrorModal } from "@/client/components/ui/ErrorModal";
import { OAuthGrantsView } from "@/client/components/ui/layout/OAuthGrantsView";

export function SettingsView({ isOpen, setIsOpen }: {
  isOpen: boolean,
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const auth = useAuth(false);

  const [passkeyVisible, setPasskeyVisible] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);

  const [currentDeviceForPin, setCurrentDeviceForPin] = useState<string | null>(null);
  const [deviceToRemove, setDeviceToRemove] = useState<string | null>(null);
  const [removeDeviceModalOpen, setRemoveDeviceModalOpen] = useState(false);
  const [timelapsesToRemove, setTimelapsesToRemove] = useState<Timelapse[]>([]);
  const [connectedServicesOpen, setConnectedServicesOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [localDevices, setLocalDevices] = useState<LocalDevice[]>([]);

  useEffect(() => {
    if (!isOpen)
      return;

    (async () => {
      setLocalDevices(await deviceStorage.getAllDevices());

      const res = await trpc.user.getDevices.query({});
      console.log("(SettingsView.tsx) user.getDevices =", res);

      if (res.ok) {
        setDevices(res.data.devices);
      }
    })();
  }, [isOpen]);

  async function handleRemoveDevice(deviceId: string) {
    if (!auth.currentUser)
      return;

    const res = await trpc.timelapse.findByUser.query({ user: auth.currentUser.id });
    if (!res.ok) {
      console.error("(SettingsView.tsx) timelapse.findByUser failed when trying to remove a device!", res);
      setError(res.message);
      return;
    }

    const unpublishedTimelapses = res.data.timelapses.filter(
      (t: Timelapse) => "private" in t && t.private && t.private.device?.id === deviceId && !t.isPublished
    );

    if (unpublishedTimelapses.length > 0) {
      setDeviceToRemove(deviceId);
      setTimelapsesToRemove(unpublishedTimelapses);
      setRemoveDeviceModalOpen(true);
    }
    else {
      await confirmRemoveDevice(deviceId);
    }
  }

  async function confirmRemoveDevice(deviceId: string) {
    const req = await trpc.user.removeDevice.mutate({ id: deviceId });
    if (!req.ok) {
      setError(req.message);
      return;
    }

    await deviceStorage.deleteDevice(deviceId);
    setDevices(devices.filter(device => device.id !== deviceId));
    setRemoveDeviceModalOpen(false);
    setDeviceToRemove(null);
    setTimelapsesToRemove([]);
  }

  function cancelRemoveDevice() {
    setRemoveDeviceModalOpen(false);
    setDeviceToRemove(null);
    setTimelapsesToRemove([]);
  }

  function handleAddPasskey(deviceId: string) {
    setCurrentDeviceForPin(deviceId);
    setPinModalOpen(true);
  }

  async function handleRemovePasskey(deviceId: string) {
    await deviceStorage.deleteDevice(deviceId);
    setLocalDevices(await deviceStorage.getAllDevices());
  }

  async function handlePinSubmit(passkey: string) {
    if (currentDeviceForPin) {
      await deviceStorage.saveDevice({
        id: currentDeviceForPin,
        passkey: passkey,
        thisDevice: false
      });
      setLocalDevices(await deviceStorage.getAllDevices());
    }
  }

  function getCurrentDevicePasskey(): string | null {
    return localDevices.find(d => d.thisDevice)?.passkey || null;
  }

  function isDeviceLocal(deviceId: string): boolean {
    return localDevices.some(d => d.id === deviceId && d.thisDevice);
  }

  function hasPasskeyForDevice(id: string) {
    return localDevices.some(x => x.id === id);
  }

  return (<div>
    <WindowedModal
      icon="settings"
      title="Settings"
      description="Some of these settings will be synchronized"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col">
            <h3 className="font-bold">Device Passkey</h3>
            <p className="text-muted">{"Click to show! You'll need this to access unpublished timelapses on other devices."}</p>
          </div>

          <div className="w-full flex justify-center">
            <button
              type="button"
              className="border border-slate w-full flex justify-center rounded-md p-3 px-8 cursor-pointer hover:bg-darker transition-colors shadow"
              onClick={() => setPasskeyVisible(!passkeyVisible)}
            >
              <span className={`font-mono text-lg tracking-widest select-none transition-all ${passkeyVisible ? "" : "blur-xs"}`}>
                { getCurrentDevicePasskey() || "000000" }
              </span>
            </button>
          </div>
        </div>
        
        <div className="flex flex-col gap-4">
          <div className="flex flex-col">
            <h3 className="text-lg font-semibold">Known Devices</h3>
            <p className="text-muted">{"In order to access unpublished timelapses from another device, you'll need its passkey."}</p>
          </div>

          {devices.length === 0 ? (
            <p className="text-muted text-sm">No devices found</p>
          ) : (
            <div className="flex flex-col gap-4">
              {devices.map(device => (
                <div key={device.id} className="flex items-center justify-between p-3 border-l-8 border-primary rounded-md">
                  <div className="flex flex-col">
                    <span className="font-medium">{device.name}</span>
                    <span className="text-sm text-muted">{device.id}</span>
                  </div>
                  <div className="flex gap-2">
                    {
                      isDeviceLocal(device.id)
                      ? <span>(this device)</span>
                      : (
                        <>
                          {
                            hasPasskeyForDevice(device.id) ? (
                              <Button
                                kind="regular"
                                onClick={() => handleRemovePasskey(device.id)}
                                className="p-2"
                              >
                                <Icon glyph="private" size={16} />
                                <span>Remove passkey</span>
                              </Button>
                            ) : (
                              <Button
                                kind="regular"
                                onClick={() => handleAddPasskey(device.id)}
                                className="p-2"
                              >
                                <Icon glyph="private" size={16} />
                                <span>Add passkey</span>
                              </Button>
                            )
                          }

                          <Button
                            kind="regular"
                            onClick={() => handleRemoveDevice(device.id)}
                            className="!px-5"
                          >
                            <Icon glyph="delete" size={20} />
                          </Button>
                        </>
                      )
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-4 pt-4">
          <Button
            kind="regular"
            onClick={() => setConnectedServicesOpen(true)}
            className="flex-1"
          >
            Connected Services
          </Button>

          <Button
            kind="regular"
            onClick={() => window.location.assign("/developer/apps")}
            className="flex-1"
          >
            Developer Apps
          </Button>
          
          <Button
            kind="primary"
            onClick={() => setIsOpen(false)}
            className="flex-1"
          >
            Close
          </Button>
        </div>
      </div>
    </WindowedModal>

    <PasskeyModal
      isOpen={pinModalOpen}
      setIsOpen={setPinModalOpen}
      description={`Enter the 6-digit PIN for ${devices.find(d => d.id === currentDeviceForPin)?.name || "Unknown Device"}`}
      onPasskeySubmit={handlePinSubmit}
    />

    <ErrorModal
      isOpen={!!error} 
      setIsOpen={(open) => !open && setError(null)}
      message={error!}
    />

    <OAuthGrantsView
      isOpen={connectedServicesOpen}
      setIsOpen={setConnectedServicesOpen}
    />

    <WindowedModal
      icon="delete"
      title="Remove Device"
      description="This action cannot be undone"
      isOpen={removeDeviceModalOpen}
      setIsOpen={setRemoveDeviceModalOpen}
    >
      <div className="flex flex-col gap-4">
        <p>
          This device has {timelapsesToRemove.length} unpublished timelapse{timelapsesToRemove.length !== 1 ? "s" : ""} that will be permanently deleted:
        </p>
        
        <div className="bg-darkless rounded-md p-3 px-4 max-h-32 overflow-y-auto">
          {timelapsesToRemove.map(timelapse => (
            <div key={timelapse.id} className="flex justify-between items-center py-1">
              <div className="flex flex-col">
                <span className="font-bold truncate">{timelapse.name}</span>
                <span className="truncate text-muted">{timelapse.description}</span>
              </div>

              <span className="text-sm text-muted ml-2">{timelapse.id.slice(0, 8)}...</span>
            </div>
          ))}
        </div>
        
        <div className="flex gap-4">
          <Button
            kind="primary"
            onClick={() => deviceToRemove && confirmRemoveDevice(deviceToRemove)}
            className="flex-1"
          >
            Remove Device
          </Button>
          <Button
            kind="regular"
            onClick={cancelRemoveDevice}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      </div>
    </WindowedModal>
  </div>);
}