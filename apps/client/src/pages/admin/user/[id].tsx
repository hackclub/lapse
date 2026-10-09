import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";
import { assert } from "@hackclub/lapse-shared";
import { AdminUserRowSchema, type AdminEntity, type AdminUserRow, type Timelapse } from "@hackclub/lapse-api";

import { api } from "@/api";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncEffect } from "@/hooks/useAsyncEffect";

import RootLayout from "@/components/layout/RootLayout";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { TimeAgo } from "@/components/TimeAgo";
import { TimelapseGrid } from "@/components/entity/TimelapseGrid";
import { Duration } from "@/components/Duration";
import { AuditLog } from "@/components/admin/AuditLog";
import { TimelapseFilters, EMPTY_TIMELAPSE_FILTERS, applyTimelapseFilters, type TimelapseFilterState } from "@/components/admin/TimelapseFilters";
import { ExternalIdLink, HackatimeProjectLink, StatusBadge, timelapseStatus, type TimelapseStatus } from "@/components/ui/AdminOnly";

const STATUSES: TimelapseStatus[] = ["PUBLIC", "UNLISTED", "PROCESSING", "FAILED"];

async function countOwnedBy(entity: AdminEntity, field: string, userId: string) {
  const res = await api.admin.list({
    entity,
    filters: [{ field, operator: "eq", value: userId }],
    page: 1,
    pageSize: 1
  });

  return res.ok ? res.data.total : null;
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      <span className="text-white truncate">{children ?? "—"}</span>
    </div>
  );
}

type HackatimeProjectGroup = {
  project: string | null;
  timelapses: Timelapse[];
  totalSeconds: number;
};

function groupByHackatimeProject(timelapses: Timelapse[]): HackatimeProjectGroup[] {
  const groups = new Map<string | null, HackatimeProjectGroup>();

  for (const timelapse of timelapses) {
    const project = timelapse.private?.hackatimeProject ?? null;
    const group = groups.get(project) ?? { project, timelapses: [], totalSeconds: 0 };

    group.timelapses.push(timelapse);
    group.totalSeconds += timelapse.duration;
    groups.set(project, group);
  }

  // Unattached timelapses go last, everything else by most time tracked.
  return [...groups.values()].sort((a, b) =>
    a.project === null ? 1 :
    b.project === null ? -1 :
    b.totalSeconds - a.totalSeconds
  );
}

function HackatimeSection({ hackatimeId, timelapses }: {
  hackatimeId: string | null;
  timelapses: Timelapse[] | null;
}) {
  if (timelapses === null)
    return <Skeleton className="w-full h-32" />;

  const groups = groupByHackatimeProject(timelapses);

  if (groups.length === 0)
    return <p className="text-muted">No timelapses to show.</p>;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-slate bg-darkless text-sm text-muted">
            <th className="px-4 py-2 font-medium">Project</th>
            <th className="px-4 py-2 font-medium">Time</th>
            <th className="px-4 py-2 font-medium">Timelapses</th>
          </tr>
        </thead>

        <tbody>
          {groups.map(group => (
            <tr key={group.project ?? "__none"} className="border-b border-slate/50 align-top">
              <td className="px-4 py-3 whitespace-nowrap">
                {group.project === null
                  ? <span className="text-muted italic">Not on Hackatime</span>
                  : hackatimeId
                    ? <HackatimeProjectLink hackatimeId={hackatimeId} project={group.project} />
                    : <code className="font-mono text-smoke">{group.project}</code>}
              </td>

              <td className="px-4 py-3 whitespace-nowrap">
                <Duration seconds={group.totalSeconds} format="long" />
              </td>

              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {group.timelapses.map(x => (
                    <Link key={x.id} href={`/timelapse/${x.id}`} className="text-white hover:underline">
                      {x.name || "(untitled)"}
                    </Link>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountCard({ label, value }: { label: ReactNode; value: number | null }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-slate bg-darkless p-4">
      {label}
      <span className="text-2xl font-bold">{value === null ? <Skeleton className="w-10" /> : value.toLocaleString()}</span>
    </div>
  );
}

export default function AdminUserPage() {
  const router = useRouter();
  const auth = useAuth(true);

  const [user, setUser] = useState<AdminUserRow | null>(null);
  const [timelapses, setTimelapses] = useState<Timelapse[] | null>(null);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TimelapseFilterState>(EMPTY_TIMELAPSE_FILTERS);

  const isAdmin = auth.currentUser?.private.permissionLevel === "ADMIN" ||
    auth.currentUser?.private.permissionLevel === "ROOT";

  useAsyncEffect(async () => {
    if (!router.isReady || !isAdmin)
      return;

    const { id } = router.query;
    assert(typeof id === "string", `router.query.id was a ${typeof id} (expected a string)`);

    setError(null);

    try {
      const userRes = await api.admin.list({
        entity: "user",
        filters: [
          id.startsWith("@")
            ? { field: "handle", operator: "eq", value: id.substring(1).trim() }
            : { field: "id", operator: "eq", value: id }
        ],
        page: 1,
        pageSize: 1
      });

      if (!userRes.ok) {
        setError(userRes.message);
        return;
      }

      const parsed = AdminUserRowSchema.safeParse(userRes.data.rows[0]);
      if (!parsed.success) {
        setError("User not found.");
        return;
      }

      setUser(parsed.data);

      const [timelapsesRes, drafts] = await Promise.all([
        api.timelapse.findByUser({ user: parsed.data.id }),
        countOwnedBy("draftTimelapse", "ownerId", parsed.data.id)
      ]);

      if (!timelapsesRes.ok) {
        setError(timelapsesRes.message);
        return;
      }

      setTimelapses(timelapsesRes.data.timelapses);
      setDraftCount(drafts);
    }
    catch {
      setError("Failed to load this user.");
    }
  }, [router.isReady, router.query, isAdmin]);

  if (auth.isLoading)
    return <RootLayout showHeader={false} title="Admin - User"><div /></RootLayout>;

  if (!isAdmin) {
    return (
      <RootLayout showHeader={false} title="Admin - User">
        <div className="flex flex-col items-center justify-center gap-4 p-16">
          <Icon glyph="private-outline" size={64} className="text-muted" />
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-muted">You don't have permission to view this page.</p>
          <Button kind="primary" href="/">Go Home</Button>
        </div>
      </RootLayout>
    );
  }

  const filtered = timelapses === null ? null : applyTimelapseFilters(timelapses, filters);

  const statusCount = (status: TimelapseStatus) =>
    filtered === null ? null : filtered.filter(x => timelapseStatus(x) === status).length;

  return (
    <RootLayout showHeader={true} title={user ? `@${user.handle} - Admin` : "Admin - User"}>
      <div className="flex flex-col gap-8 px-8 py-8 sm:px-16">
        <Link href="/admin" className="flex items-center gap-1 text-muted hover:text-white w-fit">
          <Icon glyph="view-back" size={20} />
          Back to admin
        </Link>

        {error && (
          <div className="rounded-lg border border-red bg-red/10 px-4 py-3 text-red">{error}</div>
        )}

        <div className="flex flex-col sm:flex-row gap-6 justify-between">
          <div className="flex items-center gap-6 min-w-0">
            {user
              ? <img src={user.profilePictureUrl} alt="" className="w-24 h-24 rounded-full object-cover shrink-0" />
              : <div className="w-24 h-24 rounded-full bg-slate shrink-0" />}

            <div className="flex flex-col min-w-0">
              <h1 className="text-3xl font-bold truncate">{user ? user.displayName : <Skeleton className="w-48" />}</h1>
              <p className="text-secondary text-lg">{user ? `@${user.handle}` : <Skeleton className="w-32" />}</p>
            </div>
          </div>

          {user && (
            <div className="flex flex-wrap gap-2 items-start">
              <Button icon="person" href={`/user/@${user.handle}`}>Public profile</Button>

              {user.slackId && (
                <Button icon="slack-fill" onClick={() => window.open(`https://hackclub.slack.com/team/${user.slackId}`, "_blank")}>
                  Open in Slack
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 rounded-xl border border-slate p-6">
          <InfoRow label="Lapse ID">{user?.id}</InfoRow>
          <InfoRow label="Email">{user?.email}</InfoRow>
          <InfoRow label="Permission level">{user?.permissionLevel}</InfoRow>
          <InfoRow label="Hackatime ID">
            {user?.hackatimeId && <ExternalIdLink kind="hackatime" id={user.hackatimeId} />}
          </InfoRow>
          <InfoRow label="Slack ID">
            {user?.slackId && <ExternalIdLink kind="slack" id={user.slackId} />}
          </InfoRow>
          <InfoRow label="Joined">{user && <TimeAgo date={user.createdAt} />}</InfoRow>
          <InfoRow label="Last recording">{user && <TimeAgo date={user.lastHeartbeat} />}</InfoRow>
        </div>

        {timelapses !== null && timelapses.length > 0 && (
          <TimelapseFilters timelapses={timelapses} value={filters} onChange={setFilters} />
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {STATUSES.map(status => (
            <CountCard key={status} label={<StatusBadge status={status} />} value={statusCount(status)} />
          ))}

          <CountCard label={<span className="text-sm text-muted">Drafts</span>} value={draftCount} />
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold">Hackatime</h2>
          <HackatimeSection hackatimeId={user?.hackatimeId ?? null} timelapses={filtered} />
        </section>

        {user && (
          <section className="flex flex-col gap-4">
            <h2 className="text-2xl font-bold">Admin history</h2>
            <AuditLog entity="user" entityId={user.id} pageSize={10} />
          </section>
        )}

        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold">Timelapses</h2>

          {filtered === null
            ? <Skeleton className="w-full h-48" />
            : filtered.length === 0
              ? <p className="text-muted">{timelapses?.length ? "No timelapses match these filters." : "This user has no timelapses."}</p>
              : <TimelapseGrid timelapses={filtered} />}
        </section>
      </div>
    </RootLayout>
  );
}
