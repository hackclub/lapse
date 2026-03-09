import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import { formatDuration, match } from "@hackclub/lapse-shared";
import {
  ADMIN_ENTITY_FIELDS,
  type AdminEntity,
  type AdminFilter,
  type AdminSort,
  type AdminSearchResult
} from "@hackclub/lapse-api";

import RootLayout from "@/components/layout/RootLayout";
import { Modal, ModalHeader, ModalContent } from "@/components/layout/Modal";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { TextInput } from "@/components/ui/TextInput";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/api";
import type { IconGlyph } from "@/common";

import LapseLogo from "@/assets/icon.svg";

type Stats = {
  totalLoggedSeconds: number;
  totalProjects: number;
  totalUsers: number;
};

type QueryState = {
  filters: AdminFilter[];
  sort?: AdminSort;
  page: number;
  pageSize: number;
};

type ListResult = {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
};

const ENTITY_LABELS: Record<AdminEntity, string> = {
  user: "Users",
  timelapse: "Timelapses",
  comment: "Comments",
  draftTimelapse: "Draft Timelapses"
};

const ENTITY_ICONS: Record<AdminEntity, IconGlyph> = {
  user: "person",
  timelapse: "controls",
  comment: "message",
  draftTimelapse: "docs"
};

const ENTITIES: AdminEntity[] = ["user", "timelapse", "comment", "draftTimelapse"];

function defaultQuery(): QueryState {
  return { filters: [], page: 1, pageSize: 25 };
}

function formatCellValue(value: unknown, kind: string): string {
  if (value === null || value === undefined)
    return "—";

  if (kind === "date" && typeof value === "number")
    return new Date(value).toLocaleString();

  if (kind === "number" && typeof value === "number")
    return value.toLocaleString();

  return String(value);
}

function StatCard({ label, value, icon }: { label: string; value: string | null; icon: IconGlyph }) {
  return (
    <div className="flex flex-col gap-2 p-6 rounded-2xl border border-slate bg-dark">
      <div className="flex items-center gap-2 text-muted text-base">
        <Icon glyph={icon} size={20} />
        <span>{label}</span>
      </div>
      {value !== null
        ? <span className="text-4xl font-bold">{value}</span>
        : <Skeleton className="w-24 h-8" />
      }
    </div>
  );
}

function FilterRow({ filter, fields, onUpdate, onRemove }: {
  filter: AdminFilter;
  fields: Record<string, { label: string; kind: string }>;
  onUpdate: (f: AdminFilter) => void;
  onRemove: () => void;
}) {
  const fieldOptions = Object.entries(fields);
  const currentField = fields[filter.field];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={filter.field}
        onChange={(e) => onUpdate({ ...filter, field: e.target.value })}
        className="bg-darkless border border-slate rounded-lg px-3 py-1.5 text-sm text-white outline-none"
      >
        {fieldOptions.map(([key, def]) => (
          <option key={key} value={key}>{def.label}</option>
        ))}
      </select>

      <select
        value={filter.operator}
        onChange={(e) => onUpdate({ ...filter, operator: e.target.value as AdminFilter["operator"] })}
        className="bg-darkless border border-slate rounded-lg px-3 py-1.5 text-sm text-white outline-none"
      >
        {currentField?.kind === "string" && (
          <>
            <option value="eq">equals</option>
            <option value="neq">not equals</option>
            <option value="contains">contains</option>
          </>
        )}
        {(currentField?.kind === "number" || currentField?.kind === "date") && (
          <>
            <option value="eq">equals</option>
            <option value="neq">not equals</option>
            <option value="gt">greater than</option>
            <option value="lt">less than</option>
            <option value="gte">≥</option>
            <option value="lte">≤</option>
          </>
        )}
        {currentField?.kind === "enum" && (
          <>
            <option value="eq">equals</option>
            <option value="neq">not equals</option>
          </>
        )}
      </select>

      <input
        type="text"
        value={filter.value}
        onChange={(e) => onUpdate({ ...filter, value: e.target.value })}
        placeholder="Value..."
        className="bg-darkless border border-slate rounded-lg px-3 py-1.5 text-sm text-white outline-none flex-1 min-w-32"
      />

      <button
        onClick={onRemove}
        className="text-muted hover:text-red transition-colors cursor-pointer"
      >
        <Icon glyph="view-close" size={20} />
      </button>
    </div>
  );
}

function TableCell({ value, field, entity, fieldDef, onEditClick }: {
  value: unknown;
  field: string;
  entity: AdminEntity;
  fieldDef: { label: string; kind: string; editable?: boolean; enumValues?: readonly string[] };
  onEditClick: () => void;
}) {
  const cellContentClass = "block w-full overflow-hidden text-ellipsis whitespace-nowrap";

  // Display thumbnail for timelapse records
  if (entity === "timelapse" && field === "name" && typeof value === "string") {
    return (
      <div
        className="max-w-full cursor-pointer transition-opacity hover:opacity-80"
        onClick={onEditClick}
        title="Click to edit"
      >
        <span className={cellContentClass}>{value}</span>
      </div>
    );
  }

  // Display profile picture for user records
  if (entity === "user" && field === "displayName") {
    return (
      <div
        className="max-w-full cursor-pointer transition-opacity hover:opacity-80"
        onClick={onEditClick}
        title="Click to edit"
      >
        <span className={cellContentClass}>{formatCellValue(value, fieldDef.kind)}</span>
      </div>
    );
  }

  return (
    <span
      className={`${cellContentClass} cursor-pointer transition-colors hover:text-red`}
      onClick={onEditClick}
      title="Click to edit record"
    >
      {formatCellValue(value, fieldDef.kind)}
    </span>
  );
}

function RecordEditModal({ isOpen, entity, record, fields, onClose, onSave, isSaving }: {
  isOpen: boolean;
  entity: AdminEntity;
  record: Record<string, unknown> | null;
  fields: Record<string, { label: string; kind: string; sortable?: boolean; editable?: boolean; enumValues?: readonly string[] }>;
  onClose: () => void;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  isSaving: boolean;
}) {
  const [changes, setChanges] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChanges({});
    setError(null);
  }, [isOpen]);

  if (!record) return null;

  const fieldEntries = Object.entries(fields);

  async function handleSave() {
    try {
      setError(null);
      await onSave(changes);
      onClose();
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    }
  }

  const entityName = entity === "user" ? "User" : entity === "timelapse" ? "Timelapse" : entity === "draftTimelapse" ? "Draft Timelapse" : "Comment";

  return (
    <Modal isOpen={isOpen} size="REGULAR">
      <ModalHeader
        title={`Edit ${entityName}`}
        description={`Applying edits to ${record?.["name"] ?? record?.["displayName"] ?? record?.["id"]}`}
        showCloseButton
        onClose={onClose}
        icon={match(entity, {
          user: "profile-fill",
          comment: "message",
          draftTimelapse: "instagram",
          timelapse: "instagram",
        })}
      />

      <ModalContent className="gap-4 text-base">
        {fieldEntries.map(([key, fieldDef]) => {
          const currentValue = changes.hasOwnProperty(key) ? changes[key] : record[key];
          const displayValue = String(currentValue ?? "");

          if (fieldDef.kind === "enum" && fieldDef.enumValues) {
            return (
              <div key={key} className="flex items-center gap-4">
                <label className="font-medium w-40 shrink-0">{fieldDef.label}</label>
                <select
                  value={displayValue}
                  onChange={(e) => setChanges({ ...changes, [key]: e.target.value })}
                  className="bg-darkless border border-slate rounded-lg px-3 py-2 text-white outline-none flex-1"
                >
                  {fieldDef.enumValues.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            );
          }

          if (fieldDef.kind === "date") {
            return (
              <div key={key} className="flex items-center gap-4">
                <label className="font-medium w-40 shrink-0">{fieldDef.label}</label>
                <input
                  type="text"
                  value={typeof currentValue === "number" ? new Date(currentValue).toISOString() : displayValue}
                  readOnly
                  className="border border-slate outline-red focus:outline-2 rounded-xl p-2 px-4 bg-dark text-muted flex-1"
                />
              </div>
            );
          }

          return (
            <div key={key} className="flex items-center gap-4">
              <label className="font-medium w-40 shrink-0">{fieldDef.label}</label>
              <div className="flex-1">
                <TextInput
                  type={fieldDef.kind === "number" ? "text" : "text"}
                  value={displayValue}
                  onChange={(v) => {
                      if (fieldDef.kind === "number")
                        setChanges({ ...changes, [key]: v ? Number(v) : null });
                      else
                        setChanges({ ...changes, [key]: v });
                    }}
                />
              </div>
            </div>
          );
        })}

        {error && (
          <div className="text-red text-base p-3 rounded-lg bg-red/10 border border-red/20">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end pt-4">
          <Button kind="regular" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button kind="primary" onClick={handleSave} disabled={isSaving || Object.keys(changes).length === 0}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </ModalContent>
    </Modal>
  );
}

function AdminEntityTable({ entity, query, onQueryChange, highlightedId }: {
  entity: AdminEntity;
  query: QueryState;
  onQueryChange: (q: QueryState) => void;
  highlightedId?: string | null;
}) {
  const [result, setResult] = useState<ListResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<Record<string, unknown> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fields = ADMIN_ENTITY_FIELDS[entity] as Record<string, { label: string; kind: string; sortable?: boolean; editable?: boolean; enumValues?: readonly string[] }>;
  const fieldKeys = Object.keys(fields);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await api.admin.list({
        entity,
        filters: query.filters,
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize
      });

      if (!res.ok) {
        setError(res.message);
        return;
      }

      setResult(res.data);
    }
    catch {
      setError("Failed to fetch data.");
    }
    finally {
      setIsLoading(false);
    }
  }, [entity, query]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleSort(field: string) {
    const fieldDef = fields[field];
    if (!fieldDef?.sortable) return;

    const newDirection = query.sort?.field === field && query.sort.direction === "asc" ? "desc" : "asc";
    onQueryChange({
      ...query,
      sort: { field, direction: newDirection as "asc" | "desc" },
      page: 1
    });
  }

  function handleAddFilter() {
    const firstField = fieldKeys[0];
    onQueryChange({
      ...query,
      filters: [...query.filters, { field: firstField, operator: "contains", value: "" }],
      page: 1
    });
  }

  function handleUpdateFilter(index: number, filter: AdminFilter) {
    const newFilters = [...query.filters];
    newFilters[index] = filter;
    onQueryChange({ ...query, filters: newFilters, page: 1 });
  }

  function handleRemoveFilter(index: number) {
    const newFilters = query.filters.filter((_, i) => i !== index);
    onQueryChange({ ...query, filters: newFilters, page: 1 });
  }

  async function handleSaveRecord(changes: Record<string, unknown>) {
    if (!editingRecord) return;

    setIsSaving(true);
    try {
      const res = await api.admin.update({
        entity,
        id: String(editingRecord["id"]),
        changes
      });

      if (!res.ok)
        throw new Error(res.message);

      setResult(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map(row =>
            row["id"] === editingRecord["id"] ? res.data.row : row
          )
        };
      });
    }
    finally {
      setIsSaving(false);
    }
  }

  const totalPages = result ? Math.ceil(result.total / result.pageSize) : 0;

  return (
    <>
      <RecordEditModal
        isOpen={editingRecord !== null}
        entity={entity}
        record={editingRecord}
        fields={fields}
        onClose={() => setEditingRecord(null)}
        onSave={handleSaveRecord}
        isSaving={isSaving}
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <Button kind="regular" onClick={handleAddFilter} icon="plus">
              Add Filter
            </Button>

            <Button kind="regular" onClick={fetchData} icon="view-reload">
              Refresh
            </Button>

            {result && (
              <span className="text-base text-muted ml-auto">
                {result.total} total records
              </span>
            )}
          </div>

          {query.filters.map((filter, i) => (
            <FilterRow
              key={i}
              filter={filter}
              fields={fields}
              onUpdate={(f) => handleUpdateFilter(i, f)}
              onRemove={() => handleRemoveFilter(i)}
            />
          ))}
        </div>

        {error && (
          <div className="text-red text-sm p-3 rounded-lg bg-red/10 border border-red/20">
            {error}
          </div>
        )}

      <div className="w-full overflow-x-auto rounded-xl border border-slate">
        <table className="min-w-275 w-full table-fixed text-base">
          <thead>
            <tr className="border-b border-slate bg-darkless">
              {fieldKeys.map(key => {
                const def = fields[key];
                const isSorted = query.sort?.field === key;

                return (
                  <th
                    key={key}
                    className={clsx(
                      "px-3 py-2 text-left text-sm font-medium text-muted",
                      def.sortable && "cursor-pointer hover:text-white transition-colors"
                    )}
                    onClick={() => handleSort(key)}
                  >
                    <div className="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      {def.label}
                      {isSorted && (
                        <Icon
                          glyph={query.sort?.direction === "asc" ? "up-caret" : "down-caret"}
                          size={14}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading && !result && (
              <tr>
                <td colSpan={fieldKeys.length} className="px-3 py-8 text-center text-muted text-base">
                  Loading...
                </td>
              </tr>
            )}

            {result?.rows.map((row, i) => (
              <tr
                key={String(row["id"] ?? i)}
                id={`admin-row-${String(row["id"])}`}
                className={clsx(
                  "border-b border-slate/50 hover:bg-darkless/50 transition-colors cursor-pointer",
                  highlightedId === String(row["id"]) && "bg-slate/20"
                )}
                onClick={() => setEditingRecord(row)}
              >
                {fieldKeys.map(key => {
                  const def = fields[key];

                  // Display thumbnail image for timelapse
                  if (entity === "timelapse" && key === "id") {
                    return (
                      <td key={key} className="w-20 px-3 py-2 align-top">
                        <img
                          src={String(row["thumbnailS3Key"] || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect fill='%23333' width='48' height='48'/%3E%3C/svg%3E")}
                          alt="Thumbnail"
                          className="w-12 h-12 rounded object-cover"
                        />
                      </td>
                    );
                  }

                  // Display profile picture for user
                  if (entity === "user" && key === "id") {
                    return (
                      <td key={key} className="w-20 px-3 py-2 align-top">
                        <img
                          src={String(row["profilePictureUrl"] || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect fill='%23333' width='48' height='48'/%3E%3C/svg%3E")}
                          alt="Profile"
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      </td>
                    );
                  }

                  return (
                    <td
                      key={key}
                      className="max-w-0 px-3 py-2 align-top"
                    >
                      <TableCell
                        value={row[key]}
                        field={key}
                        entity={entity}
                        fieldDef={def}
                        onEditClick={() => setEditingRecord(row)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}

            {result && result.rows.length === 0 && (
              <tr>
                <td colSpan={fieldKeys.length} className="px-3 py-8 text-center text-muted text-base">
                  No records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {result && totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            kind="regular"
            disabled={query.page <= 1}
            onClick={() => onQueryChange({ ...query, page: query.page - 1 })}
          >
            Previous
          </Button>

          <span className="text-base text-muted">
            Page {query.page} of {totalPages}
          </span>

          <Button
            kind="regular"
            disabled={query.page >= totalPages}
            onClick={() => onQueryChange({ ...query, page: query.page + 1 })}
          >
            Next
          </Button>
        </div>
      )}
      </div>
    </>
  );
}

function SearchBar({ onSelectResult }: {
  onSelectResult: (result: AdminSearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminSearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.admin.search({ query: q });
      if (res.ok) {
        setResults(res.data.results);
        setIsOpen(true);
      }
    }
    catch (err) {
      console.error("(admin) search failed", err);
    }
    finally {
      setIsLoading(false);
    }
  }, []);

  const handleSelectResult = (result: AdminSearchResult) => {
    setQuery("");
    setResults([]);
    setIsOpen(false);
    onSelectResult(result);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setIsOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={searchRef} className="relative w-full max-w-2xl">
      <div className="relative">
        <Icon glyph="search" size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search entities..."
          className="w-full rounded-xl border border-slate py-3 pl-12 pr-12 text-white placeholder-muted focus:outline-red! focus:outline-2!"
        />
        {isLoading && (
          <Icon glyph="view-reload" size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted opacity-60" />
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-dark border border-slate rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
          {results.map((result, i) => (
            <button
              key={`${result.entity}-${result.id}-${i}`}
              onClick={() => handleSelectResult(result)}
              className="w-full px-4 py-2 text-left hover:bg-darkless transition-colors border-b border-slate/50 last:border-0 flex items-center gap-3"
            >
              <Icon glyph={ENTITY_ICONS[result.entity]} size={24} className="text-muted shrink-0" />
              <div className="flex-1 min-w-0 cursor-pointer">
                <div className="text-base font-bold text-white truncate">{result.displayText}</div>
                <div className="text-sm text-muted">{ENTITY_LABELS[result.entity]}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && query.trim() && results.length === 0 && !isLoading && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-dark border border-slate rounded-lg p-3 text-muted text-sm">
          No results found
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const auth = useAuth(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeEntity, setActiveEntity] = useState<AdminEntity>("user");
  const [queries, setQueries] = useState<Record<AdminEntity, QueryState>>({
    user: defaultQuery(),
    timelapse: defaultQuery(),
    comment: defaultQuery(),
    draftTimelapse: defaultQuery()
  });
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const isAdmin = auth.currentUser?.private.permissionLevel === "ADMIN" ||
    auth.currentUser?.private.permissionLevel === "ROOT";

  useEffect(() => {
    if (!isAdmin) return;

    (async () => {
      try {
        const res = await api.admin.stats({});
        if (res.ok)
          setStats(res.data);
      }
      catch (err) {
        console.error("(admin) failed to fetch stats", err);
      }
    })();
  }, [isAdmin]);

  const handleSearchSelect = (result: AdminSearchResult) => {
    setActiveEntity(result.entity);
    setHighlightedId(result.id);

    // Calculate which page this record is on
    const pageSize = 25;
    const query = queries[result.entity];

    // We'll need to search for this on page 1 and update if needed
    setQueries(prev => ({
      ...prev,
      [result.entity]: { ...prev[result.entity], page: 1 }
    }));

    // Scroll to table after state updates
    setTimeout(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => {
        const row = document.getElementById(`admin-row-${result.id}`);
        if (row) {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
          row.classList.add("bg-slate/20");
          setTimeout(() => {
            row.classList.remove("bg-slate/20");
            setHighlightedId(null);
          }, 3000);
        }
      }, 500);
    }, 0);
  };

  if (auth.isLoading)
    return <RootLayout showHeader={false} title="Admin Dashboard"><div /></RootLayout>;

  if (!isAdmin) {
    return (
      <RootLayout showHeader={false} title="Admin Dashboard">
        <div className="flex flex-col items-center justify-center gap-4 p-16">
          <Icon glyph="private-outline" size={64} className="text-muted" />
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-muted">You don't have permission to view this page.</p>
          <Button kind="primary" href="/">Go Home</Button>
        </div>
      </RootLayout>
    );
  }

  return (
    <RootLayout showHeader={false} title="Admin Dashboard">
      <div className="flex flex-col gap-6 p-8 sm:p-12">
        <div className="flex justify-center">
          <div className="flex w-full max-w-4xl flex-wrap items-center justify-center gap-4 sm:gap-6">
            <Link href="/" aria-label="Go to homepage" className="transition-opacity hover:opacity-80">
              <LapseLogo className="h-12" />
            </Link>

            <SearchBar onSelectResult={handleSearchSelect} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Total Logged Time"
            value={stats ? formatDuration(stats.totalLoggedSeconds) : null}
            icon="clock"
          />
          <StatCard
            label="Total Timelapses"
            value={stats ? stats.totalProjects.toLocaleString() : null}
            icon="controls"
          />
          <StatCard
            label="Total Users"
            value={stats ? stats.totalUsers.toLocaleString() : null}
            icon="person"
          />
        </div>

        <div className="flex gap-2 flex-wrap border-b border-slate pb-0">
          {ENTITIES.map(entity => (
            <button
              key={entity}
              onClick={() => setActiveEntity(entity)}
              className={clsx(
                "relative -mb-px flex items-center gap-2 cursor-pointer rounded-t-lg border px-4 py-2 text-sm font-medium transition-colors outline-none appearance-none focus:outline-none focus-visible:outline-none active:outline-none",
                activeEntity === entity
                  ? "z-10 border-slate border-b-darkless bg-darkless text-white"
                  : "border-transparent text-muted hover:text-white"
              )}
            >
              <Icon glyph={ENTITY_ICONS[entity]} size={18} />
              {ENTITY_LABELS[entity]}
            </button>
          ))}
        </div>

        <div ref={tableRef}>
          <AdminEntityTable
            entity={activeEntity}
            query={queries[activeEntity]}
            onQueryChange={(q) => setQueries(prev => ({ ...prev, [activeEntity]: q }))}
            highlightedId={highlightedId}
          />
        </div>
      </div>
    </RootLayout>
  );
}
