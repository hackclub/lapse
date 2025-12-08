import { ChangeEvent, PropsWithChildren } from "react";

import { InputField } from "./InputField";

export function SelectInput({
  value,
  label,
  description,
  onChange,
  disabled,
  children
}: PropsWithChildren<{
  label: string,
  description: string,
  value: string,
  onChange: (value: string) => void,
  disabled?: boolean
}>) {
  function handleChange(ev: ChangeEvent<HTMLSelectElement>) {
    onChange(ev.target.value);
  }

  return (
    <InputField
      label={label}
      description={description}
    >
      <select
        className="p-2 rounded-md disabled:bg-dark border border-transparent outline outline-slate border-l-4 border-r-12 transition-colors"
        value={value}
        onChange={handleChange}
        disabled={disabled}
      >
        {children}
      </select>
    </InputField>
  );
}
