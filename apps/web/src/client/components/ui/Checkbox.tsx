import { ReactNode } from "react";

export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled
}: {
  label: string,
  description: ReactNode,
  checked: boolean,
  onChange: (checked: boolean) => void,
  disabled?: boolean
}) {
  function handleClick() {
    if (!disabled) {
      onChange(!checked);
    }
  }

  return (
    <div
      className={`flex flex-col gap-1 cursor-pointer select-none ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2">
        <div
          className={`flex-shrink-0 w-5 h-5 rounded border transition-colors ${
            checked
              ? "bg-red border-red"
              : "bg-dark border-slate"
          }`}
        />
        <span className="font-bold">{label}</span>
      </div>
      <span className="text-muted ml-7">{description}</span>
    </div>
  );
}
