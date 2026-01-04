import NextLink from "next/link";
import { useRouter } from "next/router";
import Icon from "@hackclub/icons";
import { useState } from "react";
import clsx from "clsx";

import LapseLogo from "@/client/assets/icon.svg";

import { useAuth } from "@/client/hooks/useAuth";

import { Button } from "@/client/components/ui/Button";
import { ProfilePicture } from "@/client/components/ProfilePicture";
import { SettingsView } from "@/client/components/ui/layout/SettingsView";
import { useCachedState } from "@/client/hooks/useCachedState";
import { useInterval } from "@/client/hooks/useInterval";
import { trpc } from "@/client/trpc";


export function Header() {
  const auth = useAuth(false);
  const router = useRouter();

  const [areSettingsOpen, setAreSettingsOpen] = useState(false);
  const [usersActive, setUsersActive] = useCachedState("usersActive", 0);

  useInterval(async () => {
    const res = await trpc.global.activeUsers.query({});
    if (!res.ok) {
      console.error("(Header.tsx) could not query active users!", res);
      return;
    }

    setUsersActive(res.data.count);
  }, 30 * 1000);

  return (
    <>
      <header className={clsx(
        "fixed bottom-0 z-10 bg-dark border-t border-black shadow", // mobile
        "sm:static sm:bg-transparent sm:border-none sm:shadow-none", // desktop
        "w-full"
      )}>
        {/* desktop */}
        <div className="hidden sm:flex px-16 py-8 pt-12 w-full justify-between">
          <div className="flex gap-6 items-center">
            <NextLink href="/">
              <LapseLogo className="w-12 h-12 transition-transform hover:scale-105 active:scale-95" />
            </NextLink>

            <div className="flex gap-1.5 px-6 py-2 h-min justify-center items-center rounded-2xl bg-dark border border-black shadow text-nowrap">
              <div aria-hidden className="w-2 h-2 rounded-full bg-green" />
              <div>{usersActive} people recording right now</div>
            </div>
          </div>

          <div className="flex gap-6 items-center">
            {
              (auth.isLoading || auth.currentUser) ? (
                <>
                  <Button href="/timelapse/create" kind="primary" icon="plus-fill">Create</Button>

                  <Icon
                    width={32} height={32}
                    className="cursor-pointer transition-transform hover:scale-110 active:scale-90"
                    glyph="settings"
                    onClick={() => setAreSettingsOpen(true)}
                  />

                  <ProfilePicture user={auth.currentUser} size="md" />
                </>
              ) : (
                <>
                  <Button href="/auth" kind="primary" icon="welcome">Sign in</Button>
                </>
              )
            }
          </div>
        </div>

        {/* mobile */}
        <div className="sm:hidden flex px-12 py-6 justify-between items-center w-full">
          <button
            className="flex flex-col items-center gap-2 cursor-pointer transition-transform active:scale-90"
            onClick={() => router.push("/")}
          >
            <Icon glyph="home" width={32} height={32} />
            <span className="text-lg">Home</span>
          </button>

          <button
            className={clsx(
              "p-4 rounded-full transition-transform",
              auth.currentUser ? "bg-red active:scale-90" : "bg-muted cursor-not-allowed"
            )}
            onClick={() => auth.currentUser && router.push("/timelapse/create")}
            disabled={!auth.currentUser}
            aria-label="Create new timelapse"
          >
            <Icon glyph="plus-fill" width={36} height={36} />
          </button>

          {
            auth.currentUser ? (
              <button
                className="flex flex-col items-center gap-2 transition-transform active:scale-90"
              >
                <ProfilePicture user={auth.currentUser} size="lg" />
                <span className="text-lg">You</span>
              </button>
            ) : (
              <button
                className="flex flex-col items-center gap-2 cursor-pointer transition-transform active:scale-90"
                onClick={() => router.push("/auth")}
              >
                <Icon glyph="welcome" width={32} height={32} />
                <span className="text-lg">Sign up</span>
              </button>
            )
          }
        </div>
      </header>

      <SettingsView
        isOpen={areSettingsOpen}
        setIsOpen={setAreSettingsOpen}
      />
    </>
  );
}