import Head from "next/head";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import Icon from "@hackclub/icons";
import { ReactNode, useState, useEffect, useCallback } from "react";

import type { KnownDevice } from "@/server/routers/api/user";
import type { Timelapse } from "@/server/routers/api/timelapse";

import { Button } from "./ui/Button";
import { ProfilePicture } from "./ui/ProfilePicture";
import { WindowedModal } from "./ui/WindowedModal";
import { TextInput } from "./ui/TextInput";
import { PasskeyModal } from "./ui/PasskeyModal";
import { useAuth } from "../hooks/useAuth";
import { deviceStorage, LocalDevice } from "../deviceStorage";
import LapseIcon from "../assets/icon.svg";
import { trpc } from "../trpc";
import { ErrorModal } from "./ui/ErrorModal";

const phantomSans = localFont({
  variable: "--font-phantom-sans",
  src: [
    {
      path: "../../../public/fonts/PhantomSans-Regular.woff2",
      weight: "400",
      style: "normal"
    },
    {
      path: "../../../public/fonts/PhantomSans-Italic.woff2",
      weight: "400",
      style: "italic"
    },
    {
      path: "../../../public/fonts/PhantomSans-Bold.woff2",
      weight: "700",
      style: "normal"
    }
  ]
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"]
});

interface RootLayoutProps {
  children: ReactNode;
  title?: string;
  description?: string;
  showHeader?: boolean;
}

export default function RootLayout({
  children,
  title = "Lapse",
  description = "Create and share timelapses with Hack Club Lapse",
  showHeader = false
}: RootLayoutProps) {
  const { currentUser, signOut } = useAuth(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [hackatimeApiKey, setHackatimeApiKey] = useState("");
  const [originalHackatimeApiKey, setOriginalHackatimeApiKey] = useState("");

  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [localDevices, setLocalDevices] = useState<LocalDevice[]>([]);
  const [currentDeviceForPin, setCurrentDeviceForPin] = useState<string | null>(null);
  const [passkeyVisible, setPasskeyVisible] = useState(false);
  const [deviceToRemove, setDeviceToRemove] = useState<string | null>(null);
  const [removeDeviceModalOpen, setRemoveDeviceModalOpen] = useState(false);
  const [timelapsesToRemove, setTimelapsesToRemove] = useState<Timelapse[]>([]);

  const [error, setError] = useState<string | null>(null);

  // Initialize hackatimeApiKey from current user data
  useEffect(() => {
    if (currentUser?.private?.hackatimeApiKey) {
      setHackatimeApiKey(currentUser.private.hackatimeApiKey);
      setOriginalHackatimeApiKey(currentUser.private.hackatimeApiKey);
    }
  }, [currentUser]);

  const saveApiKey = useCallback(async (apiKey: string) => {
    if (currentUser) {
      const res = await trpc.user.update.mutate({
        id: currentUser.id,
        changes: { hackatimeApiKey: apiKey || undefined }
      });

      if (!res.ok) {
        console.error("(root) couldn't update Hackatime API key!", res);
        setError(res.message);
        return;
      }

      console.log("(root) Hackatime API key updated!", res);
    }
  }, [currentUser]);

  const isValidUUID = (value: string): boolean => {
    if (!value) return true; // Empty is valid (optional field)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
  };

  const handleHackatimeApiKeyChange = useCallback((value: string) => {
    setHackatimeApiKey(value);
  }, []);

  function handleSaveSettings() {
    if (!isValidUUID(hackatimeApiKey)) {
      setError("That isn't a valid Hackatime API key!");
      return;
    }

    saveApiKey(hackatimeApiKey);
    setOriginalHackatimeApiKey(hackatimeApiKey);
    setSettingsModalOpen(false);
  }

  function handleCancelSettings() {
    setHackatimeApiKey(originalHackatimeApiKey);
    setSettingsModalOpen(false);
  }

  useEffect(() => {
    if (!settingsModalOpen)
      return;

    (async () => {
      setLocalDevices(await deviceStorage.getAllDevices());

      const res = await trpc.user.getDevices.query({});
      console.log("(root) user.getDevices =", res);

      if (res.ok) {
        setDevices(res.data.devices);
      }
    })();
  }, [settingsModalOpen]);

  function handleLogOut() {
    signOut();
  }

  function handleSettingsClick() {
    setOriginalHackatimeApiKey(hackatimeApiKey);
    setSettingsModalOpen(true);
  }

  async function handleRemoveDevice(deviceId: string) {
    if (!currentUser)
      return;

    const res = await trpc.timelapse.findByUser.query({ user: currentUser.id });
    if (!res.ok) {
      console.error("(root) timelapse.findByUser failed when trying to remove a device!", res);
      setError(res.message);
      return;
    }

    const unpublishedTimelapses = res.data.timelapses.filter(
      t => "private" in t && t.private && t.private.device?.id === deviceId && !t.isPublished
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

  function isDeviceLocal(deviceId: string): boolean {
    return localDevices.some(d => d.id === deviceId && d.thisDevice);
  }

  function hasPasskeyForDevice(id: string) {
    return localDevices.some(x => x.id == id);
  }

  function getCurrentDevicePasskey(): string | null {
    const currentDevice = localDevices.find(d => d.thisDevice);
    return currentDevice?.passkey || null;
  }

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className={`w-full h-full p-6 text-text bg-dark ${jetBrainsMono.variable} ${phantomSans.className}`}>        
        {currentUser && currentUser.private?.permissionLevel === "UNCONFIRMED" && (
          <div className="absolute top-0 right-0 z-10 w-full bg-yellow-600 text-black py-2 px-6 text-center font-medium">
            Your account is pending approval for the closed beta. Message ascpixi for access!
          </div>
        )}
          
        {showHeader && (
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <Link href="/">
                <LapseIcon className="w-12 h-12 transition-transform hover:scale-105" />
              </Link>
            </div>
            
            <div className="flex items-center gap-6">
              {currentUser ? (
                <>
                  <Link href="/timelapse/create">
                    <Button 
                      kind="primary"
                      onClick={() => {}}
                      className="gap-2 px-8"
                    >
                      <Icon glyph="plus-fill" size={20} />
                      Create
                    </Button>
                  </Link>

                  <Icon 
                    glyph="door-leave" 
                    size={32} 
                    className="cursor-pointer text-white hover:scale-110 transition-transform"
                    onClick={handleLogOut}
                  />

                  <Icon 
                    glyph="settings" 
                    size={32} 
                    className="cursor-pointer text-white hover:scale-110 transition-transform"
                    onClick={handleSettingsClick}
                  />
                </>
              ) : (
                <Link href="/auth">
                  <Button 
                    kind="primary"
                    onClick={() => {}}
                    className="gap-2 px-8"
                  >
                    <Icon glyph="welcome" size={20} />
                    Sign in
                  </Button>
                </Link>
              )}
              {currentUser && (
                <ProfilePicture 
                  profilePictureUrl={currentUser.profilePictureUrl}
                  displayName={currentUser.displayName}
                  size="md"
                  handle={currentUser.handle}
                />
              )}
            </div>
          </div>
        )}
        
        <main className="w-full h-full">
          {children}
        </main>

        <WindowedModal
          icon="settings"
          title="Settings"
          description="Some of these settings will be synchronized"
          isOpen={settingsModalOpen}
          setIsOpen={setSettingsModalOpen}
        >
          <div className="flex flex-col gap-6">
            <TextInput
              label="Hackatime API Key"
              description="Your API key for importing timelapses to Hackatime"
              value={hackatimeApiKey}
              onChange={handleHackatimeApiKeyChange}
              isSecret
            />

            <div className="flex flex-col gap-2">
              <div className="flex flex-col">
                <h3 className="font-bold">Device Passkey</h3>
                <p className="text-muted">{"Click to show! You'll need this to access unpublished timelapses on other devices."}</p>
              </div>

              <div className="w-full flex justify-center">
                <div 
                  className="bg-darkless w-min rounded-md p-3 px-8 cursor-pointer hover:bg-black transition-colors"
                  onClick={() => setPasskeyVisible(!passkeyVisible)}
                >
                  <span className={`font-mono text-lg tracking-widest select-none transition-all ${passkeyVisible ? "" : "blur-xs"}`}>
                    {passkeyVisible ? getCurrentDevicePasskey() || "000000" : "000000"}
                  </span>
                </div>
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
                <div className="flex flex-col gap-2">
                  {devices.map(device => (
                    <div key={device.id} className="flex items-center justify-between p-3 px-6 bg-darkless rounded-md">
                      <div className="flex flex-col">
                        <span className="font-medium">{device.name}</span>
                        <span className="text-sm text-muted">{device.id}</span>
                      </div>
                      <div className="flex gap-2">
                        {
                          isDeviceLocal(device.id)
                          ? <span>This device</span>
                          : <>
                            <Button
                              kind="primary"
                              onClick={() => handleRemoveDevice(device.id)}
                              className="p-2"
                            >
                              <Icon glyph="delete" size={16} />
                              <p>Remove</p>
                            </Button>

                          {
                            hasPasskeyForDevice(device.id) ? (
                              <Button
                                kind="primary"
                                onClick={() => handleRemovePasskey(device.id)}
                                className="p-2"
                              >
                                <Icon glyph="private" size={16} />
                                <p>Remove passkey</p>
                              </Button>
                            ) : (
                              <Button
                                kind="primary"
                                onClick={() => handleAddPasskey(device.id)}
                                className="p-2"
                              >
                                <Icon glyph="private" size={16} />
                                <p>Add passkey</p>
                              </Button>
                            )
                          }
                          </>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-4 pt-4">
              <Button
                kind="primary"
                onClick={handleSaveSettings}
                className="flex-1"
              >
                Save
              </Button>
              <Button
                kind="secondary"
                onClick={handleCancelSettings}
                className="flex-1"
              >
                Cancel
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
                kind="secondary"
                onClick={cancelRemoveDevice}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </WindowedModal>
      </div>
    </>
  );
}
