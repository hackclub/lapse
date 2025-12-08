import NextLink from "next/link";
import NextImage from "next/image";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { useAuth } from "@/client/hooks/useAuth";
import RootLayout from "@/client/components/RootLayout";
import { TimelapseCard } from "@/client/components/TimelapseCard";

import { trpc } from "@/client/trpc";
import { descending, formatDuration, formatTimeElapsed } from "@/shared/common";
import { Button } from "@/client/components/ui/Button";
import { Link } from "@/client/components/ui/Link";
import { TimeAgo } from "@/client/components/TimeAgo";
import { useCache } from "@/client/hooks/useCache";
import { useCachedApiCall } from "@/client/hooks/useCachedApiCall";

export default function Home() {
  const router = useRouter();
  const auth = useAuth(false);

  const reqLeaderboard = useCachedApiCall(() => trpc.global.weeklyLeaderboard.query({}), "leaderboard");
  const reqRecent = useCachedApiCall(() => trpc.global.recentTimelapses.query({}), "recent");

  const [totalTimeCache, setTotalTimeCache] = useCache<string>("currentUserTotalTime");
  const [totalTime, setTotalTime] = useState<string | null>(null);
  const [topUserProjects, setTopUserProjects] = useState<{
    name: string,
    time: string,
    percentage: number // [0.0, 1.0], relative to top project. topUserProjects[0].percentage is always 1.0
  }[]>([]);
  
  useEffect(() => {
    (async () => {
      if (!auth.currentUser)
        return;

      const res = await trpc.user.hackatimeProjects.query({});
      if (!res.ok) {
        console.error("(error) Could not fetch the user's Hackatime projects!", res);
        return;
      }

      const sorted = res.data.projects.toSorted(descending(x => x.time));
      setTopUserProjects(
        sorted.map(x => ({
          name: x.name,
          time: formatDuration(x.time),
          percentage: sorted[0].time / x.time
        }))
      );
    })();
  }, [auth.currentUser]);

  useEffect(() => {
    const { error } = router.query;

    if (error) {
      router.push(`/auth?error=${error}`);
    }
  }, [router.query, router]);

  function ShelfHeader({ title, description, icon }: {
    title: string,
    description: string,
    icon: string
  }) {
    return (
      <div className="flex items-center gap-4 w-full h-min">
        <img src={icon} alt="" className="block w-14 h-14" />
        
        <div className="flex flex-col">
          <h1 className="font-bold text-3xl">{title}</h1>
          <p className="text-xl">{description}</p>
        </div>
      </div>
    );
  }

  return (
    <RootLayout showHeader={true}>
      <section className="flex justify-between w-full px-32 py-12 bg-grid-gradient border-y border-black">
        <div className="flex w-full gap-8 items-center content-center">
          <NextImage
            src="/images/orpheus-time.png" alt=""
            width={1200} height={1200}
            className="w-40 h-40"
          />

          {
            auth.currentUser ? (
              <h1 className="text-3xl tracking-tight">
                Hi, <b className="text-nowrap">@{auth.currentUser.displayName}</b>! <br />
                You've recorded a total of <b className="text-nowrap">0d 0m 0s</b> of timelapses so far.
              </h1>
            ) : (
              <h1 className="text-3xl tracking-tight">
                Welcome to <b>Lapse</b>, Hack Club's timelapse time tracking tool!
              </h1>
            )
          }
        </div>

        <div className="flex flex-col w-full content-around justify-end text-right">
          {
            auth.currentUser ? (
              topUserProjects.map(x => (
                <div id={x.name} className="flex gap-2.5">
                  <span className="tracking-tight">{x.name}</span>
                  <div className="w-full bg-darkless relative">
                    <div
                      style={{ width: `${x.percentage * 100}%` }}
                      className="bg-red text-dark absolute text-right px-4"
                    >
                      {x.time}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="w-full h-full flex justify-end-safe items-center">
                <Button href="/auth" className="px-16" kind="primary" icon="welcome">Sign in</Button>
              </div>
            )
          }
        </div>
      </section>

      <div className="flex flex-col px-32 py-8">
        { reqLeaderboard && reqLeaderboard.leaderboard.length != 0 && (
          <section className="flex flex-col w-full">
            <ShelfHeader
              icon="/images/orpheus-cool.png"
              title="Leaderboard"
              description="These Hack Clubbers spent the most time documenting their work!"
            />

            <div className="flex w-full justify-between py-12">
              {
                reqLeaderboard.leaderboard.map(x => (
                  <div key={x.id} className="flex flex-col gap-1 justify-center items-center">
                    <img src={x.pfp} alt="" className="block w-30 h-30 rounded-full mb-2 shadow" />
                    <div className="text-3xl font-bold">{x.displayName}</div>
                    <div className="text-xl text-center leading-6">{`${formatDuration(x.secondsThisWeek)} recorded`}<br/>this week</div>
                  </div>
                ))
              }
            </div>
          </section>
        ) }

        { reqRecent && reqRecent.timelapses.length != 0 && (
          <section className="flex flex-col w-full gap-12">
            <ShelfHeader
              icon="/images/orpheus-woah.png"
              title="Timelapses Being Created Now"
              description="See what other Hack Clubbers are up to"
            />

            <div className="flex flex-wrap justify-between w-full gap-y-12">
              { reqRecent?.timelapses.map(x => <TimelapseCard timelapse={x} key={x.id} />) }
            </div>
          </section>
        ) }

        <footer className="py-16 text-placeholder text-center">
          A Hack Club production. Build {process.env.NEXT_PUBLIC_BUILD_ID ?? ""} from <TimeAgo date={parseInt(process.env.NEXT_PUBLIC_BUILD_DATE ?? "0")} />.
          Report issues at <Link newTab href="https://github.com/hackclub/lapse" />. 
        </footer>
      </div>
    </RootLayout>
  );
}
