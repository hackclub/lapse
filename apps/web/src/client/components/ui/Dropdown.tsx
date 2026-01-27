import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import Icon from "@hackclub/icons";

import { phantomSans } from "@/client/fonts";
import { IconGlyph } from "@/client/components/ui/util";
import { useIsMounted } from "@/client/hooks/useIsMounted";

interface DropdownEntryAny {
  // All options need to have a name, and, optionally, an icon.
  label: string;
  icon?: IconGlyph;

  /**
   * If `true`, this option will not be able to be selected. If already selected, the user will be able to switch from
   * the option, but then will not be able to select it again.
   */
  disabled?: boolean;
}

/**
 * Represents a selectable option in a `<Dropdown>` component.
 */
export interface DropdownOption<TKey extends string> extends DropdownEntryAny {
  value: TKey;
}

/**
 * Represents a group of `DropdownEntry` objects.
 */
export interface DropdownGroup<TKey extends string> extends DropdownEntryAny {
  group: DropdownEntry<TKey>[];
}

/**
 * Represents either a group or an option in a `<Dropdown>` component.
 */
export type DropdownEntry<TKey extends string> = DropdownOption<TKey> | DropdownGroup<TKey>;

/**
 * Represents the entire tree of a `<Dropdown>` component.
 */
export type DropdownTree<TKey extends string> = DropdownEntry<TKey>[];

/**
 * Recursively searches the given dropdown option tree.
 */
function findOption<TKey extends string>(key: TKey, options: DropdownTree<TKey>): DropdownOption<TKey> | null {
  for (const option of options) {
    if ("value" in option) {
      if (option.value === key)
        return option;

      continue;
    }

    const found = findOption(key, option.group);
    if (found) {
      return found;
    }
  }

  return null;
}

function findFirstOption<TKey extends string>(options: DropdownTree<TKey>): DropdownOption<TKey> | null {
  for (const option of options) {
    if ("value" in option)
      return option;

    const found = findFirstOption(option.group);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * A Lapse-styled dropdown menu. Serves as a styled and type-safe alternative to `<select>`.
 * 
 * Example usage:
 * ```
 * const [value, setValue] = useState<"ONE" | "TWO" | "THREE" | "FOUR">("ONE");
 * 
 * <Dropdown
 *  value={value}
 *  onChange={setValue}
 *  options={[
 *    { label: "One (1)", value: "ONE" },
 *    { label: "Two (2)", value: "TWO", disabled: true },
 *    {
 *      label: "Other numbers",
 *      group: [
 *        { label: "Three (3)", value: "THREE" },
 *        { label: "Four (4)", value: "FOUR" }
 *      ]
 *    }
 *  ]}
 * />
 * ```
 */
export function Dropdown<TKey extends string>({ value, onChange, options, disabled }: {
  value: TKey;
  onChange: (value: TKey) => void;
  options: DropdownTree<TKey>,
  disabled?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  const isMounted = useIsMounted();

  let isEffectivelyOpen = isOpen && !disabled;
  const anchor = mainRef.current?.getBoundingClientRect();
  
  const selected: DropdownOption<TKey> =
    findOption(value, options) ??
    findFirstOption(options) ??
    { label: "", value }; // This should never happen!

  function handleClick() {
    if (!isOpen && disabled)
      return;

    setIsOpen(!isOpen);
  }

  function handleChange(newKey: TKey) {
    if (disabled)
      return;

    onChange(newKey);
    setIsOpen(false);
  }

  function renderBranch(branch: DropdownTree<TKey>, depth = 0) {
    return branch.map(x => (
      ("value" in x) ? (
        // Regular option - the user can select this one!
        <div
          role="option"
          key={x.value}
          style={{ marginLeft: `${depth * 16}px` }}
          onClick={() => handleChange(x.value)}
          className={clsx(
            "transition-colors px-4 py-1 rounded flex items-center gap-2",
            (x.disabled) && "text-secondary",
            (!x.disabled) && "cursor-pointer hover:bg-darkless"
          )}
        >
          { x.icon && <Icon glyph={x.icon} size={18} className="text-secondary" /> }
          <span>{x.label}</span>
        </div>
      ) : (
        // This is a group of options - effectively composing a branch.
        <div
          role="group"
          key={`group-${x.label}`}
          className="flex flex-col"
        >
          <div
            className="pl-4 py-1 flex items-center gap-2"
          >
            { x.icon && <Icon glyph={x.icon} size={18} className="text-secondary" /> }
            <span>{x.label}</span>
          </div>

          <div className="border-l border-solid border-placeholder flex flex-col ml-6">
            { renderBranch(x.group, depth + 1) }
          </div>
        </div>
      )
    ));
  }

  return (
    <div ref={mainRef}>
      <div
        role="button"
        className={clsx(
          "p-2 rounded-md bg-dark border border-transparent outline outline-slate px-4 transition-colors flex items-center justify-between gap-2",
          (!disabled) && "text-smoke cursor-pointer",
          (disabled) && "bg-darkless text-secondary"
        )}
        onClick={handleClick}
      >
        <span>{selected.label}</span>
        <Icon glyph="down-caret" size={18} className="text-secondary" />
      </div>

      {/*
        When SSR-ing, we don't have access to document.body. As we have to render dropdowns on top of everything, INCLUDING parents that have
        "overflow: hidden", we unfortunately have to use a portal.
      */}
      {
        !isMounted || !mainRef
          ? undefined
          : createPortal(
            (
              <div
                style={{ top: anchor?.y, left: anchor?.x, width: anchor?.width }}
                role="listbox"
                className={clsx(
                  phantomSans.className,
                  "transition-[translate,opacity] flex flex-col absolute border border-slate bg-dark rounded-lg p-4 shadow-xl z-100 max-h-64 overflow-y-auto overscroll-contain",
                  isEffectivelyOpen && "translate-y-12 opacity-100",
                  !isEffectivelyOpen && "translate-y-10 opacity-0 pointer-events-none"
                )}
              >
                { renderBranch(options) }
              </div>
            ),
            document.body
          )
      }
    </div>
  );
}