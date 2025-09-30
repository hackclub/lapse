import { InputField } from "./InputField";

export function TextareaInput({ value, label, description, maxLength, onChange }: {
  label: string,
  description: string,
  value: string,
  maxLength?: number,
  onChange: (x: string) => void
}) {
  return (
    <InputField
      label={label}
      description={description}
    >
      <textarea
        className="border-1 border-sunken rounded-md p-2 px-4 w-full"
        value={value}
        maxLength={maxLength}
        onChange={ev => onChange(ev.target.value)}
      />
    </InputField>
  );
}