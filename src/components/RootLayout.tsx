import Head from "next/head";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";

import { ReactNode } from "react";

const phantomSans = localFont({
  variable: "--font-phantom-sans",
  src: [
    {
      path: "../../public/fonts/PhantomSans-Regular.woff2",
      weight: "400",
      style: "normal"
    },
    {
      path: "../../public/fonts/PhantomSans-Italic.woff2",
      weight: "400",
      style: "italic"
    },
    {
      path: "../../public/fonts/PhantomSans-Bold.woff2",
      weight: "700",
      style: "normal"
    }
  ]
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono"
});

interface RootLayoutProps {
  children: ReactNode;
  title?: string;
  description?: string;
}

export default function RootLayout({
  children,
  title = "Lapse - Timelapse Recording",
  description = "Create and share timelapses with Hack Club Lapse"
}: RootLayoutProps) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className={`min-h-screen w-full h-full text-text bg-white ${jetBrainsMono.variable} ${phantomSans.className}`}>        
        <main className="w-full h-full">
          {children}
        </main>
      </div>
    </>
  );
}
