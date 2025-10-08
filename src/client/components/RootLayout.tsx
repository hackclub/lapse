import Head from "next/head";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import Icon from "@hackclub/icons";

import { ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { Button } from "./ui/Button";
import { ProfilePicture } from "./ui/ProfilePicture";
import { WindowedModal } from "./ui/WindowedModal";
import { TextInput } from "./ui/TextInput";
import { PasskeyModal } from "./ui/PasskeyModal";
import { useAuth } from "../hooks/useAuth";
import { deviceStorage, LocalDevice } from "../deviceStorage";
import LapseIcon from "../assets/icon.svg";
import { trpc } from "../trpc";
import { KnownDevice } from "@/server/routers/api/user";

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
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [localDevices, setLocalDevices] = useState<LocalDevice[]>([]);
  const [currentDeviceForPin, setCurrentDeviceForPin] = useState<string | null>(null);
  const [passkeyVisible, setPasskeyVisible] = useState(false);

  // Initialize hackatimeApiKey from current user data
  useEffect(() => {
    if (currentUser?.private?.hackatimeApiKey) {
      setHackatimeApiKey(currentUser.private.hackatimeApiKey);
    }
  }, [currentUser]);

  // Debounced save function to avoid server overload
  const saveApiKey = useCallback(async (apiKey: string) => {
    if (currentUser) {
      try {
        await trpc.user.update.mutate({
          id: currentUser.id,
          changes: { hackatimeApiKey: apiKey || undefined }
        });
      }
      catch (error) {
        console.error("Failed to save Hackatime API key:", error);
      }
    }
  }, [currentUser]);

  const isValidUUID = (value: string): boolean => {
    if (!value) return true; // Empty is valid (optional field)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
  };

  const handleHackatimeApiKeyChange = useCallback((value: string) => {
    setHackatimeApiKey(value);
    
    // Clear existing timeout
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }
    
    // Only save if the value is empty or a valid UUID
    if (isValidUUID(value)) {
      debounceTimeout.current = setTimeout(() => {
        saveApiKey(value);
      }, 500);
    }
  }, [saveApiKey]);

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
    setSettingsModalOpen(true);
  }

  async function handleRemoveDevice(deviceId: string) {
    const req = await trpc.user.removeDevice.mutate({ id: deviceId });
    if (!req.ok) {
      throw new Error(req.message);
    }

    await deviceStorage.deleteDevice(deviceId);
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
                />
              )}
            </div>
          </div>
        )}
        
        <main className="w-full h-full">
          {children}
        </main>
      </div>

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
        </div>
      </WindowedModal>

      <PasskeyModal
        isOpen={pinModalOpen}
        setIsOpen={setPinModalOpen}
        description={`Enter the 6-digit PIN for ${devices.find(d => d.id === currentDeviceForPin)?.name || "Unknown Device"}`}
        onPasskeySubmit={handlePinSubmit}
      />
    </>
  );
}
