import Head from "next/head";
import { PropsWithChildren } from "react";
import clsx from "clsx";

import { Header } from "@/components/layout/Header";
import { HackatimeRelinkBanner } from "@/components/layout/HackatimeRelinkBanner";
import { HackatimeRelinkModal } from "@/components/layout/HackatimeRelinkModal";
import { LegacyRecoveryBanner } from "@/components/legacy/LegacyRecoveryBanner";
import { jetBrainsMono, phantomSans } from "@/fonts";

export default function RootLayout({
  children,
  title = "Lapse",
  description = "Track time with timelapses",
  showHeader = false,
  fitViewport = false
}: PropsWithChildren<{
  title?: string;
  description?: string;
  showHeader?: boolean;
  fitViewport?: boolean;
}>) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div
        className={clsx(
          "flex flex-col w-full sm:gap-2.5",
          fitViewport ? "h-dvh" : "h-full",
          jetBrainsMono.variable,
          phantomSans.className
        )}
      >
        <HackatimeRelinkModal />
        <HackatimeRelinkBanner />
        <LegacyRecoveryBanner />

        {showHeader && <Header />}

        <main
          className={clsx(
            "w-full",
            fitViewport ? "flex-1 min-h-0 [container-type:size]" : "h-full",
            showHeader && "pb-24 sm:pb-0"
          )}
        >
          {children}
        </main>
      </div>
    </>
  );
}
