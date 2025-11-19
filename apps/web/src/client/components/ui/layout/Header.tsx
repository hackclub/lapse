import { useState } from "react";
import Icon from "@hackclub/icons";
import NextLink from "next/link";

import LapseLogo from "@/client/assets/icon.svg";

import { useAuth } from "@/client/hooks/useAuth";

import { Button } from "../Button";
import { ProfilePicture } from "../ProfilePicture";
import { SettingsView } from "./SettingsView";


export function Header() {
  const auth = useAuth(false);

  const [areSettingsOpen, setAreSettingsOpen] = useState(false);

  return (
    <>
      <header className="flex px-16 py-8 pt-12 w-full justify-between">
        <div className="flex gap-6 items-center">
          <NextLink href="/">
            <LapseLogo className="w-12 h-12 transition-transform hover:scale-105 active:scale-95" />
          </NextLink>

          <div className="flex gap-1.5 px-6 py-2 h-min justify-center items-center rounded-2xl bg-dark border border-black shadow">
            <div aria-hidden className="w-2 h-2 rounded-full bg-green" />
            <div>32 lapsers right now</div>
          </div>
        </div>

        <div className="flex gap-6 items-center">
          {
            (auth.isLoading || auth.currentUser) ? (
              <>
                <Button href="/timelapse/create" kind="primary" icon="plus-fill">Create</Button>

                <Icon
                  width={32} height={32}
                  className="cursor-pointer"
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