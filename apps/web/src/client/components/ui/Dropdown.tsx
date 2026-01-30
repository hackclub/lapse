import { useRef, useState, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import Icon from "@hackclub/icons";

import { phantomSans } from "@/client/fonts";
import { IconGlyph } from "@/client/components/ui/util";
import { useIsMounted } from "@/client/hooks/useIsMounted";

function getSearchableLabel(entry: DropdownEntryAny): string {
  return (
    entry.searchLabel ? entry.searchLabel :
    typeof entry.label === "string" ? entry.label :
    ""
  );
}

function filterTree<TKey extends string>(tree: DropdownTree<TKey>, query: string): DropdownTree<TKey> {
  const lowerQuery = query.toLowerCase();
  const result: DropdownTree<TKey> = [];

  for (const entry of tree) {
    if ("value" in entry) {
      const searchLabel = getSearchableLabel(entry).toLowerCase();
      if (searchLabel.includes(lowerQuery) || entry.value.toLowerCase().includes(lowerQuery)) {
        result.push(entry);
      }
    }
    else {
      const filteredGroup = filterTree(entry.group, query);
      if (filteredGroup.length > 0) {
        result.push({ ...entry, group: filteredGroup });
      }
    }
  }

  return result;
}

interface DropdownEntryAny {
  // All options need to have a name, and, optionally, an icon.
  label: ReactNode;
  icon?: IconGlyph;

  /**
   * Used for filtering when `label` is a ReactNode. If not provided and `label` is a string, the label itself is used.
   */
  searchLabel?: string;

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
export function Dropdown<TKey extends string>({ value, onChange, options, disabled, allowUserCustom }: {
  value: TKey;
  onChange: (value: TKey) => void;
  options: DropdownTree<TKey>,
  disabled?: boolean,
  allowUserCustom?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const mainRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isMounted = useIsMounted();

  useEffect(() => {
    if (!isOpen)
      return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;

      if (
        mainRef.current && !mainRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  let isEffectivelyOpen = isOpen && !disabled;
  const anchor = mainRef.current?.getBoundingClientRect();
  
  const selected: DropdownOption<TKey> =
    findOption(value, options) ??
    findFirstOption(options) ??
    { label: "", value }; // This should never happen!

  const filteredOptions = allowUserCustom && inputValue
    ? filterTree(options, inputValue)
    : options;

  const showCreateOption = allowUserCustom && inputValue.trim().length > 0;

  useEffect(() => {
    if (allowUserCustom) {
      setInputValue(value);
    }
  }, [value, allowUserCustom]);

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

  function handleCreateCustom() {
    const trimmed = inputValue.trim();
    if (trimmed) {
      onChange(trimmed as TKey);
      setIsOpen(false);
    }
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
          <span className="flex-1">{x.label}</span>
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
      {
        (allowUserCustom) ? (
          <div
            className={clsx(
              "p-2 rounded-md bg-dark border border-transparent outline outline-slate px-4 transition-colors flex items-center justify-between gap-2",
              (!disabled) && "text-smoke",
              (disabled) && "bg-darkless text-secondary"
            )}
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (!isOpen) setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              placeholder={(typeof selected.label === "string" ? selected.label : selected.searchLabel) || "Type to search or create..."}
              disabled={disabled}
              className="flex-1 bg-transparent outline-none placeholder-secondary"
            />
            
            <Icon
              glyph="down-caret"
              size={18}
              className={clsx("text-secondary cursor-pointer", disabled && "cursor-not-allowed")}
              onClick={handleClick}
            />
          </div>
        ) : (
          <div
            role="button"
            className={clsx(
              "p-2 rounded-md bg-dark border border-transparent outline outline-slate px-4 transition-colors flex items-center justify-between gap-2",
              (!disabled) && "text-smoke cursor-pointer",
              (disabled) && "bg-darkless text-secondary"
            )}
            onClick={handleClick}
          >
            <span>{selected.label || value}</span>
            <Icon glyph="down-caret" size={18} className="text-secondary" />
          </div>
        )
      }

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
                ref={dropdownRef}
                style={{ top: anchor?.y, left: anchor?.x, width: anchor?.width }}
                role="listbox"
                className={clsx(
                  phantomSans.className,
                  "transition-[translate,opacity] flex flex-col absolute border border-slate bg-dark rounded-lg p-4 shadow-xl z-100 max-h-64 overflow-y-auto overscroll-contain",
                  isEffectivelyOpen && "translate-y-12 opacity-100",
                  !isEffectivelyOpen && "translate-y-10 opacity-0 pointer-events-none"
                )}
              >
                {
                  showCreateOption && (
                    <div
                      role="option"
                      onClick={handleCreateCustom}
                      className="transition-colors px-4 py-1 rounded flex items-center gap-2 cursor-pointer hover:bg-darkless text-primary"
                    >
                      <Icon glyph="plus" size={18} />
                      <span>Create &ldquo;{inputValue.trim()}&rdquo;</span>
                    </div>
                  )
                }
                { renderBranch(filteredOptions) }
              </div>
            ),
            document.body
          )
      }
    </div>
  );
}