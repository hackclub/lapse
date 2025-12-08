import NextLink from "next/link";
import Icon from "@hackclub/icons";
import { useEffect, useState } from "react";

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

  const [areSettingsOpen, setAreSettingsOpen] = useState(false);
  const [usersActive, setUsersActive] = useCachedState("usersActive", 0);

  useInterval(async () => {
    const res = await trpc.global.activeUsers.query({});
    if (!res.ok) {
      console.error("(header) could not query active users!", res);
      return;
    }

    setUsersActive(res.data.count);
  }, 30 * 1000);

  return (
    <>
      <header className="flex px-16 py-8 pt-12 w-full justify-between">
        <div className="flex gap-6 items-center">
          <NextLink href="/">
            <LapseLogo className="w-12 h-12 transition-transform hover:scale-105 active:scale-95" />
          </NextLink>

          <div className="flex gap-1.5 px-6 py-2 h-min justify-center items-center rounded-2xl bg-dark border border-black shadow">
            <div aria-hidden className="w-2 h-2 rounded-full bg-green" />
            <div>{usersActive} lapsers right now</div>
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
      </header>

      <SettingsView
        isOpen={areSettingsOpen}
        setIsOpen={setAreSettingsOpen}
      />
    </>
  );
}