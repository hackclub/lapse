export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  function handleClick() {
    if (!disabled) {
      onChange(!checked);
    }
  }

  return (
    <label
      className={clsx(
        "flex items-center gap-2 cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={handleClick}
    >
      <div
        className={`relative w-10 h-6 rounded-full transition-colors ${
          checked ? "bg-red" : "bg-slate"
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </div>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}
