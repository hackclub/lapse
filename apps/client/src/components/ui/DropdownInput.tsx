import { ReactNode } from "react";

import { InputField } from "@/components/ui/InputField";
import { Dropdown, DropdownTree } from "@/components/ui/Dropdown";

export function DropdownInput<TKey extends string>({ value, label, description, onChange, disabled, options, allowUserCustom, placeholder }: {
  value: TKey,
  options: DropdownTree<TKey>,
  onChange: (value: TKey) => void,
  label: string,
  description: ReactNode,
  disabled?: boolean,
  allowUserCustom?: boolean,
  placeholder?: string
}) {
  return (
    <InputField
      label={label}
      description={description}
    >
      <Dropdown
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        allowUserCustom={allowUserCustom}
        placeholder={placeholder}
      />
    </InputField>
  );
}
