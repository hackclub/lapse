import { ReactNode } from "react";

import { InputField } from "@/client/components/ui/InputField";
import { Dropdown, DropdownTree } from "@/client/components/ui/Dropdown";

export function DropdownInput<TKey extends string>({
  value,
  label,
  description,
  onChange,
  disabled,
  options,
  allowUserCustom
}: {
  value: TKey,
  options: DropdownTree<TKey>,
  onChange: (value: TKey) => void,
  label: string,
  description: ReactNode,
  disabled?: boolean,
  allowUserCustom?: boolean
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
      />
    </InputField>
  );
}
