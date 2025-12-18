import { ReactNode, useState } from "react";

import { Button } from "./Button";
import { WindowedModal } from "./WindowedModal";

export function PasskeyModal({ isOpen, setIsOpen, description, onPasskeySubmit, onDelete, children }: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  description: string;
  onPasskeySubmit: (passkey: string) => void;
  onDelete?: () => void;
  children?: ReactNode;
}) {
  const [passkeyInput, setPasskeyInput] = useState("");

  function handleSubmit() {
    if (passkeyInput.length === 6) {
      onPasskeySubmit(passkeyInput);
      setPasskeyInput("");
      setIsOpen(false);
    }
  }

  return (
    <WindowedModal
      icon="private"
      title="Add Passkey"
      description={description}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
    >
      <div className="flex flex-col gap-6">
        {children}

        <div className="flex flex-col gap-2">
          <div className="flex flex-col">
            <label className="font-bold">6-Digit PIN</label>
            <p>You can find it in the user settings - the cogwheel near your profile picture.</p>
          </div>

          <input
            type="text"
            maxLength={6}
            value={passkeyInput}
            onChange={(e) => setPasskeyInput(e.target.value.replace(/\D/g, ""))}
            className="bg-darkless outline-red focus:outline-2 transition-all rounded-md p-2 px-4 w-full font-mono text-center text-2xl tracking-widest"
            placeholder="000000"
            autoComplete="one-time-code"
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={passkeyInput.length !== 6}
          kind="primary"
        >
          Add Passkey
        </Button>

        {onDelete && (
          <div className="flex flex-col gap-4 pt-4 border-t border-slate text-center">
            <p className="text-muted text-sm">Forgot your PIN? You can delete this unpublished timelapse instead.</p>
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
