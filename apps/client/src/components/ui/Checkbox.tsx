import { ReactNode } from "react";

export function Checkbox({ label, description, checked, onChange, disabled, monoLabel, inline }: {
  label: string,
  description: ReactNode,
  checked: boolean,
  onChange: (checked: boolean) => void,
  disabled?: boolean,
  monoLabel?: boolean,
  inline?: boolean,
}) {
  function handleClick() {
    if (!disabled) {
      onChange(!checked);
    }
  }

  return (
    <div
      className={`flex cursor-pointer select-none ${inline ? "items-center gap-2" : "flex-col gap-1"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2">
        <div
          className={`shrink-0 w-5 h-5 rounded border transition-colors flex items-center justify-center ${
            checked
              ? "bg-red border-red"
              : "bg-dark border-slate"
          }`}
        >
          {checked && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <span className={monoLabel ? "font-mono text-[0.9em]" : "font-bold"}>{label}</span>
      </div>
      {inline
        ? <span className="text-muted text-sm">{description}</span>
        : <span className="text-muted ml-7">{description}</span>
      }
    </div>
  );
}
