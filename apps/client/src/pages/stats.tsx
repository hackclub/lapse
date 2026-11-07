import NextImage from "next/image";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Skeleton } from "skullet/react";
import type { GlobalStats } from "@hackclub/lapse-api";
import { formatDuration } from "@hackclub/lapse-shared";

import RootLayout from "@/components/layout/RootLayout";
import { Footer } from "@/components/layout/Footer";
import { TimeAgo } from "@/components/TimeAgo";

import { api } from "@/api";
import { useCachedApiCall } from "@/hooks/useCachedApiCall";
import { SAMPLE_STATS } from "@/samples";

const numberFormat = new Intl.NumberFormat("en-US");
const hoursFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const weekFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function hours(seconds: number) {
  return hoursFormat.format(seconds / 3600);
}

function percent(part: number, whole: number) {
  return whole == 0 ? 0 : Math.round(part / whole * 100);
}

function StatCard({ label, value, detail }: {
  label: string,
  value: ReactNode,
  detail?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate bg-dark px-6 py-5 flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <span className="text-4xl font-bold tracking-tight">{value}</span>
      { detail && <span className="text-muted text-sm">{detail}</span> }
    </div>
  );
}

function SplitBar({ title, segments }: {
  title: string,
  segments: { label: string, value: number, className: string }[]
}) {
  const total = segments.reduce((acc, x) => acc + x.value, 0);

  return (
    <div className="rounded-2xl border border-slate bg-dark px-6 py-5 flex flex-col gap-4">
      <h2 className="font-bold text-xl">{title}</h2>

      <div className="flex w-full h-4 rounded-full overflow-hidden bg-darkless">
        {
          segments.map(x => (
            <div
              key={x.label}
              className={x.className}
              style={{ width: `${total == 0 ? 0 : x.value / total * 100}%` }}
            />
          ))
        }
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {
          segments.map(x => (
            <div key={x.label} className="flex items-center gap-2">
              <span className={clsx("inline-block w-3 h-3 rounded-full", x.className)} />
              <span>{x.label}</span>
              <span className="font-bold">{numberFormat.format(x.value)}</span>
              <span className="text-muted">({percent(x.value, total)}%)</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

function WeeklyChart({ weeks }: { weeks: GlobalStats["weekly"] }) {
  const max = Math.max(...weeks.map(x => x.seconds), 1);

  return (
    <div className="rounded-2xl border border-slate bg-dark px-6 py-5 flex flex-col gap-4">
      <div className="flex flex-col">
        <h2 className="font-bold text-xl">Hours recorded per week</h2>
        <span className="text-muted">Published timelapses over the last {weeks.length} weeks</span>
      </div>

      <div skullet-block="" className="flex items-end gap-1 sm:gap-2 h-56">
        {
          weeks.map(x => (
            <div
              key={x.weekStart}
              className="flex-1 h-full flex flex-col justify-end items-center gap-1 group"
              title={`Week of ${weekFormat.format(x.weekStart)}: ${formatDuration(Math.round(x.seconds))} across ${numberFormat.format(x.timelapses)} timelapses`}
            >
              <span className="text-xs text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                {hours(x.seconds)}h
              </span>

              <div
                className="w-full rounded-t-md bg-red transition-all group-hover:brightness-110"
                style={{ height: `${x.seconds / max * 100}%`, minHeight: x.seconds > 0 ? "2px" : "0" }}
              />
            </div>
          ))
        }
      </div>

      <div className="flex gap-1 sm:gap-2 text-xs text-muted">
        {
          weeks.map((x, i) => (
            <span key={x.weekStart} className={clsx("flex-1 text-center", i % 2 == 1 && "max-sm:invisible")}>
              {weekFormat.format(x.weekStart)}
            </span>
          ))
        }
      </div>
    </div>
  );
}

export default function Stats() {
  const stats = useCachedApiCall(() => api.global.stats({}), "globalStats")?.stats;

  return (
    <RootLayout showHeader={true} title="Lapse Stats" description="How much Hack Clubbers have been recording with Lapse">
      <section className={clsx(
        "p-12 flex-col gap-8",
        "md:px-16 md:flex-row md:items-center",
        "lg:px-32",
        "flex w-full bg-grid-gradient border-y border-black"
      )}>
        <NextImage
          src="/images/orpheus-cool.png" alt=""
          width={1200} height={1200}
          className="w-32 h-32"
        />

        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold tracking-tight">Lapse in numbers</h1>
          <Skeleton id="stats-summary" data={stats} sample={SAMPLE_STATS} label="Counting up every timelapse recorded with Lapse">
            {x => (
              <p className="text-xl text-pretty">
                Hack Clubbers have recorded <b>{hours(x.time.totalSeconds)} hours</b> of work with Lapse so far.
              </p>
            )}
          </Skeleton>
        </div>
      </section>

      <div className="flex flex-col gap-6 px-12 sm:px-16 md:px-24 lg:px-32 py-8">
        <Skeleton id="stats" data={stats} sample={SAMPLE_STATS} label="Loading stats">
          {x => (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                    <StatCard
                      label="Hours logged"
                      value={hours(x.time.totalSeconds)}
                      detail={`${hours(x.time.thisWeekSeconds)} in the past 7 days`}
                    />

                    <StatCard
                      label="Recordings started"
                      value={numberFormat.format(x.recordings.started)}
                      detail={`${numberFormat.format(x.recordings.drafts)} still being worked on`}
                    />

                    <StatCard
                      label="Timelapses published"
                      value={numberFormat.format(x.timelapses.published)}
                      detail={`${numberFormat.format(x.timelapses.hackatimeSynced)} synced to Hackatime`}
                    />

                    <StatCard
                      label="Hack Clubbers"
                      value={numberFormat.format(x.users.total)}
                      detail={`${numberFormat.format(x.users.creators)} have published · ${numberFormat.format(x.users.newThisWeek)} joined this week`}
                    />

                    <StatCard
                      label="Average timelapse"
                      value={formatDuration(Math.round(x.time.averageTimelapseSeconds / 60) * 60)}
                    />

                    <StatCard
                      label="Longest timelapse"
                      value={formatDuration(Math.round(x.time.longestTimelapseSeconds / 60) * 60)}
                    />

                    <StatCard
                      label="Comments"
                      value={numberFormat.format(x.comments)}
                    />

                    <StatCard
                      label="Hours per Hack Clubber"
                      value={hours(x.users.creators == 0 ? 0 : x.time.totalSeconds / x.users.creators)}
                      detail="Among those who have published"
                    />
                  </div>

                  <WeeklyChart weeks={x.weekly} />

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SplitBar
                      title="Public vs. unlisted"
                      segments={[
                        { label: "Public", value: x.timelapses.public, className: "bg-green" },
                        { label: "Unlisted", value: x.timelapses.unlisted, className: "bg-muted" }
                      ]}
                    />

                    <SplitBar
                      title="Where timelapses are recorded"
                      segments={[
                        { label: "Browser", value: x.timelapses.browser, className: "bg-blue" },
                        { label: "Desktop app", value: x.timelapses.lookout, className: "bg-orange" }
                      ]}
                    />
                  </div>

                  <p className="text-muted text-center">
                    Updated <TimeAgo date={x.generatedAt} />.
                  </p>
                </>
          )}
        </Skeleton>

        <Footer />
      </div>
    </RootLayout>
  );
}
