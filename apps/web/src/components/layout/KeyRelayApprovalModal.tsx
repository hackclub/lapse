import { useState } from "react";
import type { KnownDevice } from "@hackclub/lapse-api";

import { api } from "@/api";
import { deviceStorage } from "@/deviceStorage";

import { WindowedModal } from "@/components/layout/WindowedModal";
import { Button } from "@/components/ui/Button";

export function KeyRelayApprovalModal({ isOpen, setIsOpen, exchangeId, requestingDevice, devices }: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  exchangeId: string;
  requestingDevice: string;
  devices: KnownDevice[];
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deviceName = devices.find(d => d.id === requestingDevice)?.name ?? "Unknown Device";

  async function handleApprove() {
    setIsProcessing(true);
    setError(null);

    const thisDevice = (await deviceStorage.getAllDevices()).find(d => d.thisDevice);
    if (!thisDevice) {
      setError("Could not find the key for this device.");
      setIsProcessing(false);
      return;
    }

    const res = await api.user.provideKeyRelay({
      exchangeId,
      deviceKey: thisDevice.passkey
    });

    setIsProcessing(false);

    if (!res.ok) {
      setError(res.message);
      return;
    }

    setIsOpen(false);
  }

  async function handleDeny() {
    setIsProcessing(true);
    setError(null);

    const res = await api.user.denyKeyRelay({ exchangeId });

    setIsProcessing(false);

    if (!res.ok) {
      setError(res.message);
      return;
    }

    setIsOpen(false);
  }

  return (
    <WindowedModal
      icon="private"
      title="Key Transfer Request"
      description="Another device is requesting your encryption key"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 p-4 bg-darkless rounded-md">
          <p className="text-sm text-muted">Requesting device</p>
          <p className="font-bold">{deviceName}</p>
          <p className="text-xs text-muted font-mono">{requestingDevice}</p>
        </div>

        <p className="text-sm text-muted">
          This device is requesting your encryption key via the server. If you approve, the key will be temporarily stored in server memory and delivered to the requesting device.
        </p>

        { error && (
          <p className="text-red text-sm">{error}</p>
        ) }

        <div className="flex gap-4">
          <Button
            kind="primary"
            onClick={handleApprove}
            disabled={isProcessing}
            className="flex-1"
          >
            Approve
          </Button>

          <Button
            kind="destructive"
            onClick={handleDeny}
            disabled={isProcessing}
            className="flex-1"
          >
            Deny
          </Button>
        </div>
      </div>
    </WindowedModal>
  );
}
