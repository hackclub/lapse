import type { IconGlyph } from "@/common";
import { InputField } from "@/components/ui/InputField";

export function TextareaInput({ value, label, description, icon, maxLength, onChange, mono }: {
  label: string,
  description: string,
  icon?: IconGlyph,
  mono?: boolean,
  value: string,
  maxLength?: number,
  onChange: (x: string) => void
}) {
  return (
    <InputField
      label={label}
      description={description}
      icon={icon}
    >
      <textarea
        className={`border border-slate outline-red focus:outline-2 transition-all rounded-xl p-2 px-4 w-full resize-none field-sizing-content ${mono ? "font-mono text-[0.9em]" : ""}`}
        value={value}
        maxLength={maxLength}
        onChange={ev => onChange(ev.target.value)}
      />
    </InputField>
  );
}