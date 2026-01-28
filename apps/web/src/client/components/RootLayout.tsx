import Head from "next/head";
import { PropsWithChildren } from "react";
import clsx from "clsx";

import { Header } from "@/client/components/ui/layout/Header";
import { jetBrainsMono, phantomSans } from "@/client/fonts";

export default function RootLayout({
  children,
  title = "Lapse",
  description = "Track time with timelapses",
  showHeader = false,
}: PropsWithChildren<{
  title?: string;
  description?: string;
  showHeader?: boolean;
}>) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className={clsx(
        "flex flex-col w-full h-full sm:gap-2.5",
        jetBrainsMono.variable,
        phantomSans.className
      )}>          
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
