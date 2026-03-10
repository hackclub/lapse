import platform from "platform";
import posthog from "posthog-js";
import { ENCRYPTION_KEY_LENGTH, toHex } from "@hackclub/lapse-shared";

import { deviceStorage, LocalDevice } from "@/deviceStorage";
import { api } from "@/api";

/**
 * Fetches the data associated with the current device. If such data doesn't exist, it securely generated and saved.
 */
export async function getCurrentDevice() {
  const devices = await deviceStorage.getAllDevices();
  let thisDevice = devices.find(x => x.thisDevice);

  if (thisDevice != undefined) {
    // We have a device that is marked as "thisDevice". Just to be sure - let's also verify that it exists on the server.
    const res = await api.user.getDevices({});

    if (res.ok) {
      if (!res.data.devices.some(x => x.id === thisDevice!.id)) {
        // Uh oh... it ISN'T registered on the server. Another device probably deleted it.
        console.warn("(encryption.ts) this device has been removed remotely. re-registering!");
        await deviceStorage.deleteDevice(thisDevice.id);
        thisDevice = undefined;
      }
    }
    else {
      console.error("(encryption.ts) user.getDevices failed!", res);
      console.error("(encryption.ts) assuming this device exists on the server, but something went ary!");
    }
  }

  if (thisDevice)
    return thisDevice;

  // The device has either been removed remotely or it hasn't been registered at all.
  // We need to generate a key on our end and register ourselves.
  const res = await api.user.registerDevice({
    name: platform.description ?? navigator.platform
  });

  if (!res.ok) {
    posthog.capture("device_register_error", { res, error: res.message });
    throw new Error(`Couldn't register device; ${res.error}: ${res.message}`);
  }

  const key = new Uint8Array(ENCRYPTION_KEY_LENGTH);
  crypto.getRandomValues(key);

  const assignedDevice = res.data.device;
  const device: LocalDevice = {
    id: assignedDevice.id,
    passkey: toHex(key),
    thisDevice: true
  };

  deviceStorage.saveDevice(device);
  return device;
}
