import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminAuditLogEntry, AdminAuditValue, AdminEntity } from "@hackclub/lapse-api";

import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { TimeAgo } from "@/components/TimeAgo";

const ENTITY_NAMES: Record<AdminEntity, string> = {
  user: "User",
  timelapse: "Timelapse",
  comment: "Comment",
  draftTimelapse: "Draft",
  lookoutDraft: "Lookout draft",
  legacyTimelapse: "Legacy timelapse"
};

function entityHref(entity: AdminEntity, id: string) {
  if (entity === "user")
    return `/admin/user/${id}`;

  if (entity === "timelapse")
    return `/timelapse/${id}`;

  return null;
}

function AuditValue({ value }: { value: AdminAuditValue }) {
  if (value === null || value === "")
    return <span className="italic text-muted">empty</span>;

  return <code className="rounded bg-darkless px-1.5 py-0.5 font-mono text-smoke break-all">{String(value)}</code>;
}

function AuditLogRow({ entry, showTarget }: { entry: AdminAuditLogEntry; showTarget: boolean }) {
  const href = entityHref(entry.entity, entry.entityId);

  return (
    <li className="flex flex-col gap-2 border-b border-slate/50 px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-secondary">
        {entry.actor
          ? <Link href={`/admin/user/${entry.actor.id}`} className="font-bold text-white hover:underline">@{entry.actor.handle}</Link>
          : <span className="font-bold text-white">Server console</span>}

        <span>changed</span>

        {showTarget && (
          <>
            <span>{ENTITY_NAMES[entry.entity]}</span>
            {href
              ? <Link href={href} className="font-mono text-cyan hover:underline">{entry.entityId}</Link>
              : <code className="font-mono text-smoke">{entry.entityId}</code>}
          </>
        )}

        <span className="ml-auto"><TimeAgo date={entry.createdAt} /></span>
      </div>

      <ul className="flex flex-col gap-1 text-sm">
        {Object.entries(entry.changes).map(([field, change]) => (
          <li key={field} className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white">{field}</span>
            <AuditValue value={change.from} />
            <span className="text-muted">→</span>
            <AuditValue value={change.to} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * A paginated list of changes made by administrators, optionally limited to a single entity.
 */
export function AuditLog({ entity, entityId, pageSize = 25 }: {
  entity?: AdminEntity;
  entityId?: string;
  pageSize?: number;
}) {
  const [entries, setEntries] = useState<AdminAuditLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [permissionChangesOnly, setPermissionChangesOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setError(null);

    try {
      const res = await api.admin.auditLog({ entity, entityId, permissionChangesOnly, page, pageSize });
      if (!res.ok) {
        setError(res.message);
        return;
      }

      setEntries(res.data.entries);
      setTotal(res.data.total);
    }
    catch {
      setError("Failed to load the audit log.");
    }
  }, [entity, entityId, permissionChangesOnly, page, pageSize]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={permissionChangesOnly}
            onChange={e => { setPermissionChangesOnly(e.target.checked); setPage(1); }}
            className="accent-red"
          />
          Permission level changes only
        </label>

        <Button kind="regular" onClick={fetchEntries} icon="view-reload">Refresh</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red bg-red/10 px-4 py-3 text-red">{error}</div>
      )}

      <div className="rounded-xl border border-slate">
        {entries === null && !error && <p className="px-4 py-3 text-muted">Loading...</p>}
        {entries?.length === 0 && <p className="px-4 py-3 text-muted">No changes recorded yet.</p>}

        {entries && entries.length > 0 && (
          <ul>
            {entries.map(x => <AuditLogRow key={x.id} entry={x} showTarget={entityId === undefined} />)}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button kind="regular" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-base text-muted">Page {page} of {totalPages}</span>
          <Button kind="regular" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
