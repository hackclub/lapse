import { ChangeEvent, useState } from "react";
import clsx from "clsx";

import { InputField } from "./InputField";

export function TextInput({ value, label, description, maxLength, onBlur, onChange, isSecret }: {
  label: string,
  description: string,
  value: string,
  onChange: (x: string) => void,
  onBlur?: () => void,
  maxLength?: number,
  isSecret?: boolean
}) {
  const [isFocused, setIsFocused] = useState(false);

  const inputIsPassword = isSecret && !isFocused;

  function handleChange(ev: ChangeEvent<HTMLInputElement>) {
    if (!ev.target.reportValidity())
      return;

    onChange(ev.target.value);
  }

  function handleBlur() {
    setIsFocused(false);
    onBlur?.();
  }

  return (
    <InputField
      label={label}
      description={description}
    >
      <input
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
        className={clsx(
          "border border-slate outline-red focus:outline-2 transition-all rounded-xl p-2 px-4 w-full",
          isSecret && "font-mono"
        )}
        type={inputIsPassword ? "password" : "text"}
        value={value}
        maxLength={maxLength}
        onChange={handleChange}
        autoComplete={inputIsPassword ? "new-password" : "off"}
      />
    </InputField>
  );
}