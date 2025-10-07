import { ChangeEvent } from "react";
import { InputField } from "./InputField";

export function TextInput({ value, label, description, maxLength, onChange }: {
  label: string,
  description: string,
  value: string,
  onChange: (x: string) => void,
  maxLength?: number
}) {
  function handleChange(ev: ChangeEvent<HTMLInputElement>) {
    if (!ev.target.reportValidity())
      return;

    onChange(ev.target.value);
  }

  return (
    <InputField
      label={label}
      description={description}
    >
      <input
        className="bg-darkless outline-red focus:outline-2 transition-all rounded-md p-2 px-4 w-full"
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={handleChange}
      />
    </InputField>
  );
}