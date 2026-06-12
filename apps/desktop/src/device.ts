import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";

interface LocalDevice {
  id: string;
  passkey: string;
}

export async function getCurrentDevice(): Promise<LocalDevice> {
  let device = await invoke<LocalDevice | null>("device_get");

  if (device) {
    const res = await api.user.getDevices({});
    if (res.ok) {
      if (!res.data.devices.some((d: { id: string }) => d.id === device!.id)) {
        console.warn("Device removed remotely, re-registering");
        device = null;
      }
    }
  }

  if (device) return device;

  const res = await api.user.registerDevice({ name: "Lapse Desktop" });
  if (!res.ok) {
    throw new Error(`Could not register device: ${res.message}`);
  }

  const passkey = await invoke<string>("device_generate_passkey");
  const newDevice: LocalDevice = {
    id: res.data.device.id,
    passkey,
  };

  await invoke("device_save", { id: newDevice.id, passkey: newDevice.passkey });
  return newDevice;
}
