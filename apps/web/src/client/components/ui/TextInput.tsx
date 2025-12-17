import { ChangeEvent, useState } from "react";
import clsx from "clsx";

import { InputField } from "@/client/components/ui/InputField";

type InputType = "text" | "password" | "secret";

export function TextInput({ field, value, placeholder, maxLength, onBlur, onChange, type = "text", autoComplete }: {
  field?: {
    label: string,
    description: string
  },
  value: string,
  placeholder?: string,
  maxLength?: number,
  onBlur?: () => void,
  onChange: (x: string) => void,
  type?: InputType,
  autoComplete?: string
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

  const isSecret = type === "password" || type === "secret";
  const isApiKey = type === "secret";

  const shouldMask = isSecret && !isFocused && !isApiKey;
  const displayValue = shouldMask ? "•".repeat(value.length) : value;
  const inputType = type === "secret" ? "text" : (type === "password" && !isFocused ? "password" : "text");

  const input = (
    <input
      onFocus={() => setIsFocused(true)}
      onBlur={handleBlur}
      className={clsx(
        "border border-slate outline-red focus:outline-2 transition-all rounded-xl p-2 px-4 w-full",
        isSecret && "font-mono"
      )}
      type={inputType}
      value={displayValue}
      maxLength={maxLength}
      onChange={handleChange}
      autoComplete={autoComplete ?? (type === "password" ? "new-password" : "off")}
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