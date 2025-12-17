import { ChangeEvent, useState } from "react";
import clsx from "clsx";

import { InputField } from "@/client/components/ui/InputField";

export function TextInput({ field, value, placeholder, maxLength, onBlur, onChange, isSecret, autoComplete, isApiKey }: {
  field?: {
    label: string,
    description: string
  },
  value: string,
  placeholder?: string,
  maxLength?: number,
  onBlur?: () => void,
  onChange: (x: string) => void,
  isSecret?: boolean,
  autoComplete?: string,
  isApiKey?: boolean
}) {
  const [isFocused, setIsFocused] = useState(false);

  function handleChange(ev: ChangeEvent<HTMLInputElement>) {
    if (!ev.target.reportValidity())
      return;

    onChange(ev.target.value);
  }

  function handleBlur() {
    setIsFocused(false);
    onBlur?.();
  }

  const displayValue = isSecret && !isFocused && !isApiKey ? "•".repeat(value.length) : value;

  const input = (
    <input
      onFocus={() => setIsFocused(true)}
      onBlur={handleBlur}
      className={clsx(
        "border border-slate outline-red focus:outline-2 transition-all rounded-xl p-2 px-4 w-full",
        isSecret && "font-mono"
      )}
      type="text"
      value={displayValue}
      maxLength={maxLength}
      onChange={handleChange}
      autoComplete={autoComplete ?? (isSecret && !isApiKey ? "new-password" : "off")}
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