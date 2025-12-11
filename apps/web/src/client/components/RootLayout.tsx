import Head from "next/head";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import { PropsWithChildren } from "react";
import clsx from "clsx";

import { Header } from "@/client/components/ui/layout/Header";
import { useInterval } from "@/client/hooks/useInterval";
import { trpc } from "@/client/trpc";
import { useAuth } from "@/client/hooks/useAuth";

const phantomSans = localFont({
  variable: "--font-phantom-sans",
  src: [
    {
      path: "../../../public/fonts/PhantomSans-Regular.woff2",
      weight: "400",
      style: "normal"
    },
    {
      path: "../../../public/fonts/PhantomSans-Italic.woff2",
      weight: "400",
      style: "italic"
    },
    {
      path: "../../../public/fonts/PhantomSans-Bold.woff2",
      weight: "700",
      style: "normal"
    }
  ]
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"]
});

export default function RootLayout({
  children,
  title = "Lapse",
  description = "Track time with timelapses",
  showHeader = false
}: PropsWithChildren<{
  title?: string;
  description?: string;
  showHeader?: boolean;
}>) {
  const auth = useAuth(false);

  useInterval(async () => {
    if (auth.currentUser) {
      await trpc.user.emitHeartbeat.mutate({});
    }
  }, 30 * 1000);

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
        
        <main className="w-full h-full">
          {children}
        </main>
      </div>
    </>
  );
}
