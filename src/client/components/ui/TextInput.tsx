import { ChangeEvent, useState } from "react";
import clsx from "clsx";

import { InputField } from "./InputField";

export function TextInput({ value, label, description, maxLength, onChange, isSecret }: {
  label: string,
  description: string,
  value: string,
  onChange: (x: string) => void,
  maxLength?: number,
  isSecret?: boolean
}) {
  const [isFocused, setIsFocused] = useState(false);

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
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={clsx(
          "bg-darkless outline-red focus:outline-2 transition-all rounded-md p-2 px-4 w-full",
          isSecret && "font-mono"
        )}
        type={isSecret ? (isFocused ? "text" : "password") : "text"}
        value={value}
        maxLength={maxLength}
        onChange={handleChange}
        autoComplete="off"
      />
    </InputField>
  );
}