import { ReactNode } from "react";

import { InputField } from "@/client/components/ui/InputField";
import { Dropdown, DropdownTree } from "@/client/components/ui/Dropdown";

export function DropdownInput<TKey extends string>({
  value,
  label,
  description,
  onChange,
  disabled,
  options
}: {
  value: TKey,
  options: DropdownTree<TKey>,
  onChange: (value: TKey) => void,
  label: string,
  description: ReactNode,
  disabled?: boolean
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
      />
    </InputField>
  );
}
