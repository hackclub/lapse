import { useCallback, useState, type ReactNode } from "react";
import type { KnownDevice } from "@hackclub/lapse-api";

import { api } from "@/api";
import { DeviceStorage, deviceStorage } from "@/deviceStorage";
import { useAuthContext } from "@/context/AuthContext";
import { useInterval } from "@/hooks/useInterval";
import { KeyRelayApprovalModal } from "@/components/layout/KeyRelayApprovalModal";

export function KeyRelayProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuthContext();

  const [relayRequest, setRelayRequest] = useState<{ exchangeId: string; callingDevice: string } | null>(null);
  const [relayApprovalOpen, setRelayApprovalOpen] = useState(false);
  const [devices, setDevices] = useState<KnownDevice[]>([]);

  const pollRelayRequests = useCallback(async () => {
    // Browsers without OPFS (let through /update-browser via the bypass flag, or the /lookout/ embeds) have no
    // local device store, so there is no device key to relay.
    if (!currentUser || !DeviceStorage.isSupported())
      return;

    const thisDevice = (await deviceStorage.getAllDevices()).find(d => d.thisDevice);
    if (!thisDevice)
      return;

    const res = await api.user.queryKeyRelayRequest({ callingDevice: thisDevice.id });
    if (!res.ok)
      return;

    if (res.data.request && !relayApprovalOpen) {
      const devicesRes = await api.user.getDevices({});
      if (devicesRes.ok)
        setDevices(devicesRes.data.devices);

      setRelayRequest({
        exchangeId: res.data.request.exchangeId,
        callingDevice: res.data.request.callingDevice
      });
      
      setRelayApprovalOpen(true);
    }
  }, [currentUser, relayApprovalOpen]);

  useInterval(pollRelayRequests, 6000);

  return (
    <>
      {children}

      {relayRequest && (
        <KeyRelayApprovalModal
          isOpen={relayApprovalOpen}
          setIsOpen={setRelayApprovalOpen}
          exchangeId={relayRequest.exchangeId}
          requestingDevice={relayRequest.callingDevice}
          devices={devices}
        />
      )}
    </>
  );
}
