import { useEffect } from "react";
import NextImage from "next/image";
import { useRouter } from "next/router";

import RootLayout from "@/components/layout/RootLayout";
import { useMaintenanceContext } from "@/context/MaintenanceContext";

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const dateTimeZoneFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

export default function MaintenancePage() {
  const router = useRouter();
  const { maintenance } = useMaintenanceContext();

  useEffect(() => {
    if (maintenance === null)
      router.replace("/");
  }, [maintenance, router]);

  const start = maintenance && new Date(maintenance.startsAt);
  const end = maintenance && new Date(maintenance.endsAt);
  const sameDay = start && end && start.toDateString() === end.toDateString();

  return (
    <RootLayout showHeader={false} title="Maintenance - Lapse">
      <div className="h-full flex flex-col items-center justify-center gap-6 px-8 py-16 text-center bg-grid-gradient-up">
        <NextImage
          src="/images/orpheus-time.png" alt=""
          width={1200} height={1200}
          className="w-32 h-32"
        />

        <div className="flex flex-col gap-3 max-w-xl">
          <h1 className="text-3xl font-bold tracking-tight">Lapse is down for scheduled maintenance</h1>
          <p className="text-smoke text-lg text-pretty">
            {start && end && (
              <>
                Lapse will be unavailable from <b>{dateTimeFormat.format(start)}</b> to <b>{(sameDay ? timeFormat : dateTimeZoneFormat).format(end)}</b>.{" "}
              </>
            )}
            <b><i>No data is lost!</i></b> Timelapses started before the downtime will finish compiling once Lapse is back, so there's <b>NO NEED to ask in help channels</b>.
          </p>
        </div>
      </div>
    </RootLayout>
  );
}
