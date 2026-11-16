import Head from "next/head";
import { PropsWithChildren } from "react";
import clsx from "clsx";

import { Header } from "@/components/layout/Header";
import { HackatimeRelinkBanner } from "@/components/layout/HackatimeRelinkBanner";
import { HackatimeRelinkModal } from "@/components/layout/HackatimeRelinkModal";
import { LegacyRecoveryBanner } from "@/components/legacy/LegacyRecoveryBanner";
import { jetBrainsMono, phantomSans } from "@/fonts";

export default function RootLayout({ children, title = "Lapse", description = "Track time with timelapses", image, video, showHeader = false }: PropsWithChildren<{
  title?: string;
  description?: string;
  /** An absolute URL to show as the link preview's picture. */
  image?: string | null;
  /** An absolute URL to an MP4 that link previews may play inline. */
  video?: string | null;
  showHeader?: boolean;
}>) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />

        <meta property="og:site_name" content="Lapse" key="og:site_name" />
        <meta property="og:title" content={title} key="og:title" />
        <meta property="og:description" content={description} key="og:description" />
        <meta property="og:type" content={video ? "video.other" : "website"} key="og:type" />
        { image && <meta property="og:image" content={image} key="og:image" /> }
        { video && <meta property="og:video" content={video} key="og:video" /> }
        { video && <meta property="og:video:type" content="video/mp4" key="og:video:type" /> }
        <meta name="twitter:card" content={image ? "summary_large_image" : "summary"} key="twitter:card" />
      </Head>

      <div className={clsx(
        "flex flex-col w-full h-full sm:gap-2.5",
        jetBrainsMono.variable,
        phantomSans.className
      )}>
        <HackatimeRelinkModal />
        <HackatimeRelinkBanner />
        <LegacyRecoveryBanner />

        { showHeader && <Header /> }
        
        <main className={clsx(
          "w-full h-full",
          showHeader && "pb-24 sm:pb-0"
        )}>
          {children}
        </main>
      </div>
    </>
  );
}
