import { ReactNode, useEffect, useRef, useState } from "react";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { toHex } from "@hackclub/lapse-shared";

import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { WindowedModal } from "@/components/layout/WindowedModal";

type RelayState =
  | { stage: "idle" }
  | { stage: "requesting" }
  | { stage: "polling"; exchangeId: string }
  | { stage: "success"; deviceKey: string }
  | { stage: "error"; message: string };

export function PasskeyModal({ isOpen, setIsOpen, description, targetDeviceId, callingDeviceId, onPasskeySubmit, onDelete, children }: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  description: string;
  targetDeviceId: string;
  callingDeviceId: string;
  onPasskeySubmit: (passkey: string) => void;
  onDelete?: () => void;
  children?: ReactNode;
}) {
  const [wordInput, setWordInput] = useState("");
  const [relay, setRelay] = useState<RelayState>({ stage: "idle" });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setRelay({ stage: "idle" });
      setWordInput("");

      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (pollingRef.current)
        clearInterval(pollingRef.current);
    };
  }, []);

  async function startRelay() {
    setRelay({ stage: "requesting" });

    const res = await api.user.requestKeyRelay({
      targetDevice: targetDeviceId,
      callingDevice: callingDeviceId
    });

    if (!res.ok) {
      setRelay({ stage: "error", message: res.message });
      return;
    }

    const exchangeId = res.data.exchangeId;
    setRelay({ stage: "polling", exchangeId });

    pollingRef.current = setInterval(async () => {
      const pollRes = await api.user.receiveKeyRelay({ exchangeId });

      if (!pollRes.ok) {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
        setRelay({ stage: "error", message: pollRes.message });
        return;
      }

      if (pollRes.data.relay) {
        clearInterval(pollingRef.current!);
        pollingRef.current = null;

        const deviceKey = pollRes.data.relay.deviceKey;
        setRelay({ stage: "success", deviceKey });

        onPasskeySubmit(deviceKey);
        setIsOpen(false);
      }
    }, 2000);
  }

  function handleWordSubmit() {
    const words = wordInput.trim().split(/\s+/);
    if (words.length !== 12)
      return;

    try {
      const hexKey = toHex(bip39.mnemonicToEntropy(words.join(" "), wordlist));
      onPasskeySubmit(hexKey);
      setWordInput("");
      setIsOpen(false);
    }
    catch {
      setRelay({ stage: "error", message: "One or more words are invalid. Please check and try again." });
    }
  }

  const wordCount = wordInput.trim() ? wordInput.trim().split(/\s+/).length : 0;

  return (
    <WindowedModal
      icon="private"
      title="Add Device Key"
      description={description}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="flex flex-col gap-6">
        {children}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col">
            <label className="font-bold">Transfer via Server</label>
            <p className="text-muted text-sm">Request the key from the other device. The owner of that device will be asked to approve the transfer.</p>
          </div>

          {relay.stage === "idle" && (
            <Button kind="primary" onClick={startRelay}>
              Request Key Transfer
            </Button>
          )}

          {relay.stage === "requesting" && (
            <div className="flex items-center justify-center gap-2 p-3 bg-darkless rounded-md text-muted">
              <span className="animate-pulse">Requesting...</span>
            </div>
          )}

          {relay.stage === "polling" && (
            <div className="flex items-center justify-center gap-2 p-3 bg-darkless rounded-md text-muted">
              <span className="animate-pulse">Waiting for approval from the other device...</span>
            </div>
          )}

          {relay.stage === "error" && (
            <div className="flex flex-col gap-2">
              <p className="text-red text-sm">{relay.message}</p>
              <Button kind="regular" onClick={() => setRelay({ stage: "idle" })}>
                Try Again
              </Button>
            </div>
          )}

          {relay.stage === "success" && (
            <div className="flex items-center justify-center gap-2 p-3 bg-darkless rounded-md text-green-400">
              Key received!
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1 border-t border-slate" />
          <span className="text-muted text-sm font-bold">OR</span>
          <div className="flex-1 border-t border-slate" />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col">
            <label className="font-bold">Enter Recovery Words</label>
            <p className="text-muted text-sm">Type the 12 words shown on the other device, separated by spaces.</p>
          </div>

          <textarea
            value={wordInput}
            onChange={(e) => setWordInput(e.target.value.toLowerCase())}
            className="bg-darkless outline-red focus:outline-2 transition-all rounded-md p-3 px-4 w-full font-mono text-sm resize-none h-24"
            placeholder="word1 word2 word3 ..."
          />

          <p className="text-muted text-xs">{wordCount}/12 words</p>
        </div>

        <Button
          onClick={handleWordSubmit}
          disabled={wordCount !== 12}
          kind="primary"
        >
          Add Key
        </Button>

        {onDelete && (
          <div className="flex flex-col gap-4 pt-4 border-t border-slate text-center">
            <p className="text-muted text-sm">Lost access to the other device? You can delete this unpublished timelapse instead.</p>
            <Button
              onClick={onDelete}
              kind="destructive"
            >
              Delete Timelapse
            </Button>
          </div>
        )}
      </div>
    </WindowedModal>
  );
}
