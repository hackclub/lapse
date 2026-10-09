import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import type { Timelapse } from "@hackclub/lapse-api";

/**
 * in case no hackatime project is attached
 */
export const NO_PROJECT = "__none";

export type TimelapseFilterState = {
  from: string;
  to: string;
  projects: string[];
};

export const EMPTY_TIMELAPSE_FILTERS: TimelapseFilterState = { from: "", to: "", projects: [] };

export function projectKeyOf(timelapse: Timelapse) {
  return timelapse.private?.hackatimeProject ?? NO_PROJECT;
}

export function applyTimelapseFilters(timelapses: Timelapse[], filters: TimelapseFilterState) {
  const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : null;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : null;

  return timelapses.filter(x =>
    (from === null || x.createdAt >= from) &&
    (to === null || x.createdAt <= to) &&
    (filters.projects.length === 0 || filters.projects.includes(projectKeyOf(x)))
  );
}

function ProjectDropdown({ options, selected, onChange }: {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const query = search.trim().toLowerCase();
  const shown = options.filter(x => (x === NO_PROJECT ? "not on hackatime" : x.toLowerCase()).includes(query));

  function toggle(option: string) {
    onChange(selected.includes(option) ? selected.filter(x => x !== option) : [...selected, option]);
  }

  const summary =
    selected.length === 0 ? "All projects" :
    selected.length === 1 ? (selected[0] === NO_PROJECT ? "Not on Hackatime" : selected[0]) :
    `${selected.length} projects`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-64 items-center justify-between gap-2 rounded-lg border border-slate bg-dark px-3 py-2 text-left text-white cursor-pointer hover:border-muted"
      >
        <span className="truncate">{summary}</span>
        <Icon glyph="down-caret" size={18} className="shrink-0 text-muted" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-2 flex w-80 flex-col rounded-lg border border-slate bg-dark shadow-xl">
          <div className="relative border-b border-slate p-2">
            <Icon glyph="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects..."
              autoFocus
              className="w-full rounded-md border border-slate bg-darker py-1.5 pl-8 pr-2 text-sm text-white placeholder-muted"
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted">No matching projects.</p>
            )}

            {shown.map(option => (
              <label
                key={option}
                className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-darkless"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggle(option)}
                  className="accent-red"
                />

                <span className={clsx("truncate", option === NO_PROJECT ? "italic text-muted" : "font-mono text-white")}>
                  {option === NO_PROJECT ? "Not on Hackatime" : option}
                </span>
              </label>
            ))}
          </div>

          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="border-t border-slate px-3 py-2 text-left text-sm text-muted cursor-pointer hover:text-white"
            >
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function TimelapseFilters({ timelapses, value, onChange }: {
  timelapses: Timelapse[];
  value: TimelapseFilterState;
  onChange: (value: TimelapseFilterState) => void;
}) {
  const projects = [...new Set(timelapses.map(projectKeyOf))]
    .sort((a, b) => a === NO_PROJECT ? 1 : b === NO_PROJECT ? -1 : a.localeCompare(b));

  const isFiltered = value.from !== "" || value.to !== "" || value.projects.length > 0;
  const dateInputClass = "rounded-lg border border-slate bg-dark px-3 py-2 text-white [color-scheme:dark]";

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate p-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">From</span>
        <input
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={e => onChange({ ...value, from: e.target.value })}
          className={dateInputClass}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">To</span>
        <input
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={e => onChange({ ...value, to: e.target.value })}
          className={dateInputClass}
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">Hackatime project</span>
        <ProjectDropdown
          options={projects}
          selected={value.projects}
          onChange={selected => onChange({ ...value, projects: selected })}
        />
      </div>

      {isFiltered && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_TIMELAPSE_FILTERS)}
          className="py-2 text-sm text-muted cursor-pointer hover:text-white"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}
