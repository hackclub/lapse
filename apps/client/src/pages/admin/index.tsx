import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import clsx from "clsx";
import Icon from "@hackclub/icons";
import { formatDuration, match } from "@hackclub/lapse-shared";
import { ADMIN_ENTITY_FIELDS, OAUTH_SCOPE_GROUPS, type AdminEntity, type AdminFilter, type AdminSort, type AdminSearchResult, type OAuthApp, type OAuthTrustLevel, type ProgramKeyMetadata } from "@hackclub/lapse-api";

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

type AdminAppFormState = {
  name: string;
  description: string;
  homepageUrl: string;
  iconUrl: string;
  redirectUris: string;
  scopes: string[];
  trustLevel: OAuthTrustLevel;
};

type AdminFieldKind = "string" | "number" | "date" | "enum" | "boolean";

type AdminFieldDef = {
  label: string;
  kind: AdminFieldKind;
  sortable?: boolean;
  editable?: boolean;
  enumValues?: readonly string[];
};

type AdminRecord = Record<string, unknown>;

const ENTITIES = ["user", "timelapse", "comment", "draftTimelapse", "legacyTimelapse", "app", "programKey"] as const;

type AdminPanelEntity = typeof ENTITIES[number];

const ENTITY_LABELS: Record<AdminPanelEntity, string> = {
  user: "Users",
  timelapse: "Timelapses",
  comment: "Comments",
  draftTimelapse: "Draft Timelapses",
  legacyTimelapse: "Legacy Timelapses",
  app: "Apps",
  programKey: "Program Keys"
};

const ENTITY_ICONS: Record<AdminPanelEntity, IconGlyph> = {
  user: "person",
  timelapse: "controls",
  comment: "message",
  draftTimelapse: "docs",
  legacyTimelapse: "profile-fill",
  app: "code",
  programKey: "private-outline"
};

const ADMIN_FIELD_OPERATORS: Record<AdminFieldKind, Array<{ value: AdminFilter["operator"]; label: string }>> = {
  string: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "not equals" },
    { value: "contains", label: "contains" }
  ],
  number: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "not equals" },
    { value: "gt", label: "greater than" },
    { value: "lt", label: "less than" },
    { value: "gte", label: "≥" },
    { value: "lte", label: "≤" }
  ],
  date: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "not equals" },
    { value: "gt", label: "greater than" },
    { value: "lt", label: "less than" },
    { value: "gte", label: "≥" },
    { value: "lte", label: "≤" }
  ],
  enum: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "not equals" }
  ],
  boolean: [
    { value: "eq", label: "equals" },
    { value: "neq", label: "not equals" }
  ]
};

const FALLBACK_IMAGE_DATA_URL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect fill='%23333' width='48' height='48'/%3E%3C/svg%3E";

const APP_TABLE_COLUMNS = ["App", "Client ID", "Trust", "Owner", "Created", "Redirect URIs", "Scopes"] as const;

function isAdminPanelEntity(value: string): value is AdminPanelEntity {
  return ENTITIES.includes(value as AdminPanelEntity);
}

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

function AdminFieldRow({ label, align = "center", children }: {
  label: string;
  align?: "center" | "start";
  children: ReactNode;
}) {
  return (
    <div className={clsx("flex gap-4", align === "start" ? "items-start" : "items-center")}>
      <label className={clsx("font-medium w-40 shrink-0", align === "start" && "pt-2")}>{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ModalError({ error, size = "base" }: { error: string | null; size?: "sm" | "base" }) {
  if (!error)
    return null;

  return (
    <div className={clsx(
      "rounded-lg border border-red/20 bg-red/10 text-red",
      size === "sm" ? "p-3 text-sm" : "p-3 text-base"
    )}>
      {error}
    </div>
  );
}

function ModalActions({ isSaving, isSaveDisabled, onClose, onSave }: {
  isSaving: boolean;
  isSaveDisabled?: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex gap-3 justify-end pt-4">
      <Button kind="regular" onClick={onClose} disabled={isSaving}>Cancel</Button>
      <Button kind="primary" onClick={onSave} disabled={isSaving || isSaveDisabled}>
        {isSaving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );
}

function TableStatusRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-muted text-base">
        {children}
      </td>
    </tr>
  );
}

function PreviewImage({ src, alt, className }: { src: unknown; alt: string; className: string }) {
  return (
    <img
      src={String(src || FALLBACK_IMAGE_DATA_URL)}
      alt={alt}
      className={className}
    />
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | null; icon: IconGlyph }) {
  return (
    <div className="flex flex-col gap-2 p-6 rounded-2xl border border-slate bg-dark">
      <div className="flex items-center gap-2 text-muted text-base">
        <Icon glyph={icon} size={20} />
        <span>{label}</span>
      </div>

      { 
        value !== null
          ? <span className="text-4xl font-bold">{value}</span>
          : <Skeleton className="w-24 h-8" />
      }
    </div>
  );
}

function FilterRow({ filter, fields, onUpdate, onRemove }: {
  filter: AdminFilter;
  fields: Record<string, AdminFieldDef>;
  onUpdate: (f: AdminFilter) => void;
  onRemove: () => void;
}) {
  const fieldOptions = Object.entries(fields);
  const currentField = fields[filter.field];
  const operatorOptions = ADMIN_FIELD_OPERATORS[currentField?.kind ?? "string"];

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
        {operatorOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
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
  fieldDef: AdminFieldDef;
  onEditClick: () => void;
}) {
  const cellContentClass = "block w-full overflow-hidden text-ellipsis whitespace-nowrap";
  const usesSoftHover = (entity === "timelapse" && field === "name" && typeof value === "string")
    || (entity === "user" && field === "displayName");

  return (
    <span
      className={clsx(
        cellContentClass,
        "cursor-pointer transition-colors",
        usesSoftHover ? "hover:opacity-80" : "hover:text-red"
      )}
      onClick={onEditClick}
      title={usesSoftHover ? "Click to edit" : "Click to edit record"}
    >
      {formatCellValue(value, fieldDef.kind)}
    </span>
  );
}

function RecordEditModal({ isOpen, entity, record, fields, onClose, onSave, isSaving }: {
  isOpen: boolean;
  entity: AdminEntity;
  record: AdminRecord | null;
  fields: Record<string, AdminFieldDef>;
  onClose: () => void;
  onSave: (changes: AdminRecord) => Promise<void>;
  isSaving: boolean;
}) {
  const [changes, setChanges] = useState<AdminRecord>({});
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    setChanges({});
    setError(null);
  }, [isOpen]);

  if (!record)
    return null;

  const fieldEntries = Object.entries(fields);
  const recordName = record["name"] ?? record["displayName"] ?? record["id"];
  const entityName = entity === "user" ? "User" : entity === "timelapse" ? "Timelapse" : entity === "draftTimelapse" ? "Draft Timelapse" : entity === "legacyTimelapse" ? "Legacy Timelapse" : "Comment";

  function setChange(key: string, value: unknown) {
    setChanges(prev => ({ ...prev, [key]: value }));
  }

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

  async function handleExport() {
    setIsExporting(true);
    try {
      const res = await api.admin.export({ entity, id: String(record!["id"]) });
      if (!res.ok) {
        setError(res.message ?? "Failed to export record.");
        return;
      }

      const blob = new Blob([JSON.stringify(res.data.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export record.");
    }
    finally {
      setIsExporting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} size="REGULAR">
      <ModalHeader
        title={`Edit ${entityName}`}
        description={`Applying edits to ${recordName}`}
        showCloseButton
        onClose={onClose}
        icon={match(entity, {
          user: "profile-fill",
          comment: "message",
          draftTimelapse: "instagram",
          timelapse: "instagram",
          legacyTimelapse: "profile-fill",
        })}
      />

      <ModalContent className="gap-4 text-base">
        {fieldEntries.map(([key, fieldDef]) => {
          const currentValue = Object.prototype.hasOwnProperty.call(changes, key) ? changes[key] : record[key];
          const displayValue = String(currentValue ?? "");

          if (fieldDef.kind === "enum" && fieldDef.enumValues) {
            return (
              <AdminFieldRow key={key} label={fieldDef.label}>
                <select
                  value={displayValue}
                  onChange={(e) => setChange(key, e.target.value)}
                  className="bg-darkless border border-slate rounded-lg px-3 py-2 text-white outline-none flex-1"
                >
                  {fieldDef.enumValues.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </AdminFieldRow>
            );
          }

          if (fieldDef.kind === "date") {
            return (
              <AdminFieldRow key={key} label={fieldDef.label}>
                <input
                  type="text"
                  value={typeof currentValue === "number" ? new Date(currentValue).toISOString() : displayValue}
                  readOnly
                  className="border border-slate outline-red focus:outline-2 rounded-xl p-2 px-4 bg-dark text-muted flex-1"
                />
              </AdminFieldRow>
            );
          }

          return (
            <AdminFieldRow key={key} label={fieldDef.label}>
              <TextInput
                type="text"
                value={displayValue}
                onChange={(value) => setChange(key, fieldDef.kind === "number" ? (value ? Number(value) : null) : value)}
              />
            </AdminFieldRow>
          );
        })}

        <ModalError error={error} />
        <div className="flex gap-3 justify-between pt-4">
          <Button kind="regular" onClick={handleExport} disabled={isExporting}>
            {isExporting ? "Exporting..." : "Export JSON"}
          </Button>
          <div className="flex gap-3">
            <Button kind="regular" onClick={onClose} disabled={isSaving}>Cancel</Button>
            <Button kind="primary" onClick={handleSave} disabled={isSaving || Object.keys(changes).length === 0}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}

const PROGRAM_KEY_TABLE_COLUMNS = ["Name", "Key Prefix", "Scopes", "Created By", "Expires", "Last Used", "Status"];

function getKeyStatus(key: ProgramKeyMetadata): { label: string; color: string } {
  if (key.revokedAt)
    return { label: "Revoked", color: "red" };
  if (new Date(key.expiresAt) < new Date())
    return { label: "Expired", color: "yellow" };
  return { label: "Active", color: "green" };
}

function AdminProgramKeysTable() {
  const [keys, setKeys] = useState<ProgramKeyMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createScopes, setCreateScopes] = useState<string[]>([]);
  const [createExpiresInDays, setCreateExpiresInDays] = useState("90");
  const [isCreating, setIsCreating] = useState(false);
  const [rawKeyResult, setRawKeyResult] = useState<string | null>(null);

  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<ProgramKeyMetadata | null>(null);
  const [editName, setEditName] = useState("");
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const fetchKeys = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await api.admin.programKey.list({});
      if (!res.ok) {
        setError(res.message ?? "Unable to load program keys.");
        return;
      }
      setKeys(res.data.keys);
    }
    catch (err) {
      console.error("(admin/programKeys) failed to load", err);
      setError("Unable to load program keys.");
    }
    finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  async function handleCreate() {
    setIsCreating(true);
    setError(null);

    try {
      const days = parseInt(createExpiresInDays);
      if (isNaN(days) || days < 1 || days > 365) {
        setError("Expiration must be between 1 and 365 days.");
        return;
      }

      const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;

      const res = await api.admin.programKey.create({
        name: createName,
        scopes: createScopes,
        expiresAt
      });

      if (!res.ok) {
        setError(res.message ?? "Failed to create program key.");
        return;
      }

      setKeys(prev => [res.data.key, ...prev]);
      setRawKeyResult(res.data.rawKey);
      setCreateOpen(false);
      setCreateName("");
      setCreateScopes([]);
      setCreateExpiresInDays("90");
    }
    catch (err) {
      console.error("(admin/programKeys) failed to create", err);
      setError("Failed to create program key.");
    }
    finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke() {
    if (!revokeId) return;
    setIsSaving(true);

    try {
      const res = await api.admin.programKey.revoke({ id: revokeId });
      if (!res.ok) {
        setError(res.message ?? "Failed to revoke key.");
        return;
      }
      await fetchKeys();
      setRevokeId(null);
    }
    catch (err) {
      console.error("(admin/programKeys) failed to revoke", err);
      setError("Failed to revoke key.");
    }
    finally {
      setIsSaving(false);
    }
  }

  async function handleRotate() {
    if (!rotateId) return;
    setIsSaving(true);

    try {
      const res = await api.admin.programKey.rotate({ id: rotateId });
      if (!res.ok) {
        setError(res.message ?? "Failed to rotate key.");
        return;
      }
      setKeys(prev => prev.map(k => k.id === rotateId ? res.data.key : k));
      setRawKeyResult(res.data.rawKey);
      setRotateId(null);
    }
    catch (err) {
      console.error("(admin/programKeys) failed to rotate", err);
      setError("Failed to rotate key.");
    }
    finally {
      setIsSaving(false);
    }
  }

  async function handleUpdate() {
    if (!editKey) return;
    setIsSaving(true);

    try {
      const res = await api.admin.programKey.update({ id: editKey.id, name: editName, scopes: editScopes });
      if (!res.ok) {
        setError(res.message ?? "Failed to update key.");
        return;
      }
      setKeys(prev => prev.map(k => k.id === editKey.id ? res.data.key : k));
      setEditKey(null);
    }
    catch (err) {
      console.error("(admin/programKeys) failed to update", err);
      setError("Failed to update key.");
    }
    finally {
      setIsSaving(false);
    }
  }

  function toggleCreateScope(scope: string) {
    setCreateScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  }

  function toggleEditScope(scope: string) {
    setEditScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  }

  return (
    <>
      {/* Create Key Modal */}
      <Modal isOpen={createOpen} size="REGULAR">
        <ModalHeader
          title="Create Program Key"
          description="Generate a new service-wide API key"
          showCloseButton
          onClose={() => setCreateOpen(false)}
          icon="private-outline"
        />
        <ModalContent className="gap-4 text-base">
          <AdminFieldRow label="Name">
            <TextInput value={createName} onChange={setCreateName} placeholder="e.g. Analytics Service" />
          </AdminFieldRow>

          <AdminFieldRow label="Expires in" align="start">
            <div className="flex items-center gap-2">
              <TextInput value={createExpiresInDays} onChange={setCreateExpiresInDays} placeholder="90" />
              <span className="text-muted text-sm whitespace-nowrap">days (max 365)</span>
            </div>
          </AdminFieldRow>

          <AdminFieldRow label="Scopes" align="start">
            <div className="rounded-xl border border-slate bg-dark p-4">
              <div className="grid gap-4">
                {Object.entries(OAUTH_SCOPE_GROUPS).map(([group, scopes]) => (
                  <div key={group} className="grid gap-2">
                    <span className="text-sm font-semibold text-white">{group}</span>
                    <div className="grid gap-2">
                      {Object.entries(scopes).map(([scope, description]) => (
                        <label key={scope} className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={createScopes.includes(scope)}
                            onChange={() => toggleCreateScope(scope)}
                            className="mt-1"
                          />
                          <span className="flex flex-col">
                            <span className="text-sm text-white">{scope}</span>
                            <span className="text-sm text-muted">{description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </AdminFieldRow>

          <div className="flex gap-3 justify-end pt-4">
            <Button kind="regular" onClick={() => setCreateOpen(false)} disabled={isCreating}>Cancel</Button>
            <Button kind="primary" onClick={handleCreate} disabled={isCreating || !createName.trim() || createScopes.length === 0}>
              {isCreating ? "Creating..." : "Create Key"}
            </Button>
          </div>
        </ModalContent>
      </Modal>

      {/* Revoke Confirmation Modal */}
      <Modal isOpen={!!revokeId} size="SMALL">
        <ModalHeader title="Revoke Program Key" description="This action cannot be undone" showCloseButton onClose={() => setRevokeId(null)} icon="delete" />
        <ModalContent className="gap-4 text-base">
          <p className="text-muted">Revoking this key will immediately prevent any service using it from authenticating.</p>
          <div className="flex gap-3 justify-end pt-2">
            <Button kind="regular" onClick={() => setRevokeId(null)} disabled={isSaving}>Cancel</Button>
            <Button kind="primary" onClick={handleRevoke} disabled={isSaving}>
              {isSaving ? "Revoking..." : "Revoke Key"}
            </Button>
          </div>
        </ModalContent>
      </Modal>

      {/* Rotate Confirmation Modal */}
      <Modal isOpen={!!rotateId} size="SMALL">
        <ModalHeader title="Rotate Program Key" description="This will invalidate the existing key" showCloseButton onClose={() => setRotateId(null)} icon="announcement" />
        <ModalContent className="gap-4 text-base">
          <p className="text-muted">Rotating the key will immediately invalidate the existing key. The new key will be shown once.</p>
          <div className="flex gap-3 justify-end pt-2">
            <Button kind="regular" onClick={() => setRotateId(null)} disabled={isSaving}>Cancel</Button>
            <Button kind="primary" onClick={handleRotate} disabled={isSaving}>
              {isSaving ? "Rotating..." : "Rotate Key"}
            </Button>
          </div>
        </ModalContent>
      </Modal>

      {/* Edit Key Modal */}
      <Modal isOpen={!!editKey} size="REGULAR">
        <ModalHeader
          title="Edit Program Key"
          description={editKey ? `Editing "${editKey.name}"` : ""}
          showCloseButton
          onClose={() => setEditKey(null)}
          icon="settings"
        />
        <ModalContent className="gap-4 text-base">
          <AdminFieldRow label="Name">
            <TextInput value={editName} onChange={setEditName} placeholder="e.g. Analytics Service" />
          </AdminFieldRow>

          <AdminFieldRow label="Scopes" align="start">
            <div className="rounded-xl border border-slate bg-dark p-4">
              <div className="grid gap-4">
                {Object.entries(OAUTH_SCOPE_GROUPS).map(([group, scopes]) => (
                  <div key={group} className="grid gap-2">
                    <span className="text-sm font-semibold text-white">{group}</span>
                    <div className="grid gap-2">
                      {Object.entries(scopes).map(([scope, description]) => (
                        <label key={scope} className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editScopes.includes(scope)}
                            onChange={() => toggleEditScope(scope)}
                            className="mt-1"
                          />
                          <span className="flex flex-col">
                            <span className="text-sm text-white">{scope}</span>
                            <span className="text-sm text-muted">{description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </AdminFieldRow>

          <ModalActions isSaving={isSaving} onClose={() => setEditKey(null)} onSave={handleUpdate} />
        </ModalContent>
      </Modal>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Button kind="primary" onClick={() => setCreateOpen(true)} icon="plus">
            Create Program Key
          </Button>
          <Button kind="regular" onClick={fetchKeys} icon="view-reload" disabled={isLoading}>
            Refresh
          </Button>
          <span className="text-base text-muted ml-auto">
            {keys.length} total keys
          </span>
        </div>

        {rawKeyResult && (
          <div className="rounded-2xl border border-red bg-dark p-6 text-red-200">
            <p className="font-semibold text-lg">This is your program key — it won&apos;t be shown again!</p>
            <p className="mt-2 break-all">
              <span className="font-mono text-sm select-all">{rawKeyResult}</span>
            </p>
            <Button kind="regular" onClick={() => setRawKeyResult(null)} className="mt-3">
              Dismiss
            </Button>
          </div>
        )}

        <ModalError error={error} size="sm" />

        <div className="w-full overflow-x-auto rounded-xl border border-slate">
          <table className="min-w-275 w-full table-fixed text-base">
            <thead>
              <tr className="border-b border-slate bg-darkless">
                {PROGRAM_KEY_TABLE_COLUMNS.map(column => (
                  <th key={column} className="px-3 py-2 text-left text-sm font-medium text-muted">{column}</th>
                ))}
                <th className="px-3 py-2 text-left text-sm font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && keys.length === 0 && (
                <TableStatusRow colSpan={PROGRAM_KEY_TABLE_COLUMNS.length + 1}>Loading program keys...</TableStatusRow>
              )}

              {keys.map(key => {
                const status = getKeyStatus(key);
                return (
                  <tr key={key.id} className="border-b border-slate/50 hover:bg-darkless/50 transition-colors">
                    <td className="px-3 py-2 align-top font-semibold text-white">{key.name}</td>
                    <td className="px-3 py-2 align-top">
                      <span className="font-mono text-sm text-muted">pk_lapse_{key.keyPrefix}...</span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map(scope => (
                          <span key={scope} className="rounded-full bg-dark px-2 py-1 text-xs text-muted border border-slate">
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-sm">
                      @{key.createdBy.handle}
                    </td>
                    <td className="px-3 py-2 align-top text-sm text-muted">
                      {new Date(key.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 align-top text-sm text-muted">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={clsx(
                        "inline-flex rounded-full px-2 py-1 text-xs font-semibold",
                        `bg-${status.color}/15 text-${status.color}`
                      )}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {!key.revokedAt && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditKey(key); setEditName(key.name); setEditScopes([...key.scopes]); }}
                            className="text-sm text-muted hover:text-white transition-colors cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setRotateId(key.id)}
                            className="text-sm text-muted hover:text-white transition-colors cursor-pointer"
                          >
                            Rotate
                          </button>
                          <button
                            onClick={() => setRevokeId(key.id)}
                            className="text-sm text-red hover:text-red/80 transition-colors cursor-pointer"
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!isLoading && keys.length === 0 && (
                <TableStatusRow colSpan={PROGRAM_KEY_TABLE_COLUMNS.length + 1}>No program keys found.</TableStatusRow>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function buildAdminAppFormState(app: OAuthApp): AdminAppFormState {
  return {
    name: app.name,
    description: app.description,
    homepageUrl: app.homepageUrl,
    iconUrl: app.iconUrl,
    redirectUris: app.redirectUris.join("\n"),
    scopes: app.scopes,
    trustLevel: app.trustLevel
  };
}

function AdminAppEditModal({ app, isSaving, onClose, onSave }: {
  app: OAuthApp | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (formState: AdminAppFormState) => Promise<void>;
}) {
  const [formState, setFormState] = useState<AdminAppFormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setFormState(app ? buildAdminAppFormState(app) : null);
  }, [app]);

  if (!app || !formState)
    return null;

  function setFormValue<K extends keyof AdminAppFormState>(key: K, value: AdminAppFormState[K]) {
    setFormState(prev => prev ? { ...prev, [key]: value } : prev);
  }

  async function handleSave() {
    if (!formState)
      return;

    try {
      setError(null);
      await onSave(formState);
      onClose();
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    }
  }

  function toggleScope(scope: string) {
    setFormState(prev => {
      if (!prev)
        return prev;

      return {
        ...prev,
        scopes: prev.scopes.includes(scope)
          ? prev.scopes.filter(entry => entry !== scope)
          : [...prev.scopes, scope]
      };
    });
  }

  return (
    <Modal isOpen={app !== null} size="REGULAR">
      <ModalHeader
        title="Edit App"
        description={`Applying edits to ${app.name}`}
        showCloseButton
        onClose={onClose}
        icon="code"
      />

      <ModalContent className="gap-4 text-base">
        <AdminFieldRow label="Name">
          <TextInput value={formState.name} onChange={(value) => setFormValue("name", value)} />
        </AdminFieldRow>

        <AdminFieldRow label="Description" align="start">
          <textarea
            value={formState.description}
            onChange={(e) => setFormValue("description", e.target.value)}
            rows={4}
            className="flex-1 rounded-xl border border-slate bg-dark px-4 py-2 text-white outline-red focus:outline-2 resize-y"
          />
        </AdminFieldRow>

        <AdminFieldRow label="Homepage URL">
          <TextInput value={formState.homepageUrl} onChange={(value) => setFormValue("homepageUrl", value)} />
        </AdminFieldRow>

        <AdminFieldRow label="Icon URL">
          <TextInput value={formState.iconUrl} onChange={(value) => setFormValue("iconUrl", value)} />
        </AdminFieldRow>

        <AdminFieldRow label="Trust">
          <select
            value={formState.trustLevel}
            onChange={(e) => setFormValue("trustLevel", e.target.value as OAuthTrustLevel)}
            className="bg-darkless border border-slate rounded-lg px-3 py-2 text-white outline-none flex-1"
          >
            <option value="UNTRUSTED">UNTRUSTED</option>
            <option value="TRUSTED">TRUSTED</option>
          </select>
        </AdminFieldRow>

        <AdminFieldRow label="Redirect URIs" align="start">
          <textarea
            value={formState.redirectUris}
            onChange={(e) => setFormValue("redirectUris", e.target.value)}
            rows={4}
            className="flex-1 rounded-xl border border-slate bg-dark px-4 py-2 text-white outline-red focus:outline-2 resize-y"
          />
        </AdminFieldRow>

        <AdminFieldRow label="Scopes" align="start">
          <div className="rounded-xl border border-slate bg-dark p-4">
            <div className="grid gap-4">
              {Object.entries(OAUTH_SCOPE_GROUPS).map(([group, scopes]) => (
                <div key={group} className="grid gap-2">
                  <span className="text-sm font-semibold text-white">{group}</span>

                  <div className="grid gap-2">
                    {Object.entries(scopes).map(([scope, description]) => (
                      <label key={scope} className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formState.scopes.includes(scope)}
                          onChange={() => toggleScope(scope)}
                          className="mt-1"
                        />

                        <span className="flex flex-col">
                          <span className="text-sm text-white">{scope}</span>
                          <span className="text-sm text-muted">{description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </AdminFieldRow>

        <ModalError error={error} />
        <ModalActions isSaving={isSaving} onClose={onClose} onSave={handleSave} />
      </ModalContent>
    </Modal>
  );
}

function AdminAppsTable() {
  const [apps, setApps] = useState<OAuthApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editingApp, setEditingApp] = useState<OAuthApp | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchApps = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await api.developer.getAllApps({});

      if (!res.ok) {
        setError(res.message ?? "Unable to load apps.");
        return;
      }

      setApps(res.data.apps);
    }
    catch (err) {
      console.error("(admin/apps) failed to load", err);
      setError("Unable to load apps.");
    }
    finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  async function handleSaveApp(formState: AdminAppFormState) {
    if (!editingApp)
      return;

    setIsSaving(true);
    setError(null);

    try {
      const redirectUris = formState.redirectUris
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);

      const updateResult = await api.developer.updateApp({
        id: editingApp.id,
        name: formState.name,
        description: formState.description,
        homepageUrl: formState.homepageUrl,
        iconUrl: formState.iconUrl,
        redirectUris,
        scopes: formState.scopes,
      });

      if (!updateResult.ok)
        throw new Error(updateResult.message ?? "Unable to update app.");

      let updatedApp = updateResult.data.app;

      if (formState.trustLevel !== editingApp.trustLevel) {
        const trustResult = await api.developer.updateAppTrustLevel({
          id: editingApp.id,
          trustLevel: formState.trustLevel
        });

        if (!trustResult.ok)
          throw new Error(trustResult.message ?? "Unable to update trust.");

        updatedApp = { ...updatedApp, trustLevel: trustResult.data.trustLevel };
      }

      setApps(prev => prev.map(app => app.id === editingApp.id ? updatedApp : app));
      setEditingApp(null);
    }
    catch (err) {
      console.error("(admin/apps) failed to save", err);
      throw err;
    }
    finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <AdminAppEditModal
        app={editingApp}
        isSaving={isSaving}
        onClose={() => setEditingApp(null)}
        onSave={handleSaveApp}
      />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Button kind="regular" onClick={fetchApps} icon="view-reload" disabled={isLoading}>
            Refresh
          </Button>

          <span className="text-base text-muted ml-auto">
            {apps.length} total apps
          </span>
        </div>

        <ModalError error={error} size="sm" />

        <div className="w-full overflow-x-auto rounded-xl border border-slate">
          <table className="min-w-275 w-full table-fixed text-base">
            <thead>
              <tr className="border-b border-slate bg-darkless">
                {APP_TABLE_COLUMNS.map((column) => (
                  <th key={column} className="px-3 py-2 text-left text-sm font-medium text-muted">{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && apps.length === 0 && (
                <TableStatusRow colSpan={APP_TABLE_COLUMNS.length}>Loading apps...</TableStatusRow>
              )}

              {apps.map((app) => (
                <tr key={app.id} className="border-b border-slate/50 hover:bg-darkless/50 transition-colors cursor-pointer" onClick={() => setEditingApp(app)}>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-white">{app.name}</span>
                      <span className="text-sm text-muted line-clamp-2">{app.description || "No description"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">{app.clientId}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className={clsx(
                      "inline-flex rounded-full px-2 py-1 text-xs font-semibold",
                      app.trustLevel === "TRUSTED"
                        ? "bg-green/15 text-green"
                        : "bg-yellow/15 text-yellow"
                    )}>
                      {app.trustLevel}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {app.createdBy ? `@${app.createdBy.handle}` : "(system)"}
                  </td>
                  <td className="px-3 py-2 align-top text-sm text-muted">
                    {new Date(app.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-col gap-1 text-sm text-muted">
                      {app.redirectUris.length > 0
                        ? app.redirectUris.map(uri => (
                            <span key={uri} className="block overflow-hidden text-ellipsis whitespace-nowrap">{uri}</span>
                          ))
                        : <span>None</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      {app.scopes.length > 0
                        ? app.scopes.map(scope => (
                            <span key={scope} className="rounded-full bg-dark px-2 py-1 text-xs text-muted border border-slate">
                              {scope}
                            </span>
                          ))
                        : <span className="text-sm text-muted">None</span>}
                    </div>
                  </td>
                </tr>
              ))}

              {!isLoading && apps.length === 0 && (
                <TableStatusRow colSpan={APP_TABLE_COLUMNS.length}>No apps found.</TableStatusRow>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
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
  const [editingRecord, setEditingRecord] = useState<AdminRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fields = ADMIN_ENTITY_FIELDS[entity] as Record<string, AdminFieldDef>;
  const fieldKeys = Object.keys(fields);
  const tableColumnKeys = [
    ...(entity === "timelapse" ? ["__thumbnail"] : []),
    ...(entity === "user" ? ["__profilePicture"] : []),
    ...fieldKeys,
  ];

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

  async function handleSaveRecord(changes: AdminRecord) {
    if (!editingRecord)
      return;

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
          <ModalError error={error} size="sm" />
        )}

      <div className="w-full overflow-x-auto rounded-xl border border-slate">
        <table className="min-w-275 w-full table-fixed text-base">
          <thead>
            <tr className="border-b border-slate bg-darkless">
              {tableColumnKeys.map(key => {
                const def = fields[key];
                const isSorted = query.sort?.field === key;
                const isPreviewColumn = key.startsWith("__");

                return (
                  <th
                    key={key}
                    className={clsx(
                      "px-3 py-2 text-left text-sm font-medium text-muted",
                      def?.sortable && "cursor-pointer hover:text-white transition-colors"
                    )}
                    onClick={() => !isPreviewColumn && handleSort(key)}
                  >
                    <div className="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      {key === "__thumbnail"
                        ? "Thumbnail"
                        : key === "__profilePicture"
                          ? "Profile Picture"
                          : def.label}
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
              <TableStatusRow colSpan={tableColumnKeys.length}>Loading...</TableStatusRow>
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
                {tableColumnKeys.map(key => {
                  const def = fields[key];

                  if (key === "__thumbnail") {
                    return (
                      <td key={key} className="px-3 py-2 align-top">
                        <PreviewImage src={row["thumbnailUrl"]} alt="Thumbnail" className="h-12 w-auto max-w-none rounded object-cover" />
                      </td>
                    );
                  }

                  if (key === "__profilePicture") {
                    return (
                      <td key={key} className="w-20 px-3 py-2 align-top">
                        <PreviewImage src={row["profilePictureUrl"]} alt="Profile" className="w-12 h-12 rounded-full object-cover" />
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
              <TableStatusRow colSpan={tableColumnKeys.length}>No records found.</TableStatusRow>
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
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
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
  const router = useRouter();
  const auth = useAuth(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeEntity, setActiveEntity] = useState<AdminPanelEntity>("user");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [queries, setQueries] = useState<Record<AdminEntity, QueryState>>({
    user: defaultQuery(),
    timelapse: defaultQuery(),
    comment: defaultQuery(),
    draftTimelapse: defaultQuery(),
    legacyTimelapse: defaultQuery()
  });

  const tableRef = useRef<HTMLDivElement>(null);

  const isAdmin = auth.currentUser?.private.permissionLevel === "ADMIN" ||
    auth.currentUser?.private.permissionLevel === "ROOT";

  useEffect(() => {
    if (!isAdmin)
      return;

    (async () => {
      try {
        const res = await api.admin.stats({});
        if (res.ok) {
          setStats(res.data);
        }
      }
      catch (err) {
        console.error("(admin) failed to fetch stats", err);
      }
    })();
  }, [isAdmin]);

  useEffect(() => {
    if (!router.isReady)
      return;

    const requestedSection = router.query.section;
    if (typeof requestedSection !== "string" || !isAdminPanelEntity(requestedSection))
      return;

    setActiveEntity(requestedSection);
  }, [router.isReady, router.query.section]);

  function handleEntityChange(entity: AdminPanelEntity) {
    setActiveEntity(entity);

    const nextQuery = entity === "user"
      ? {}
      : { ...router.query, section: entity };

    void router.replace({
      pathname: router.pathname,
      query: nextQuery
    }, undefined, { shallow: true });
  }

  const handleSearchSelect = (result: AdminSearchResult) => {
    handleEntityChange(result.entity);
    setHighlightedId(result.id);

    setQueries(prev => ({
      ...prev,
      [result.entity]: { ...prev[result.entity], page: 1 }
    }));

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
          {ENTITIES
            .filter(entity => entity !== "programKey" || auth.currentUser?.private.permissionLevel === "ROOT")
            .map(entity => (
            <button
              key={entity}
              onClick={() => handleEntityChange(entity)}
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
          {activeEntity === "app"
            ? <AdminAppsTable />
            : activeEntity === "programKey"
            ? <AdminProgramKeysTable />
            : (
                <AdminEntityTable
                  entity={activeEntity}
                  query={queries[activeEntity]}
                  onQueryChange={(q) => setQueries(prev => ({ ...prev, [activeEntity]: q }))}
                  highlightedId={highlightedId}
                />
              )}
        </div>
      </div>
    </RootLayout>
  );
}
