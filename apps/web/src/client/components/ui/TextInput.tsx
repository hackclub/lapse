import { ChangeEvent, useState } from "react";
import clsx from "clsx";

import { InputField } from "@/client/components/ui/InputField";

export function TextInput({ field, value, placeholder, maxLength, onBlur, onChange, isSecret }: {
  field?: {
    label: string,
    description: string
  },
  value: string,
  placeholder?: string,
  maxLength?: number,
  onBlur?: () => void,
  onChange: (x: string) => void,
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

  const input = (
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
      placeholder={placeholder}
    />
  );

  if (field) {
    return (
      <InputField label={field.label} description={field.description}>
        {input}
      </InputField>
    );
  }

  return input;
}