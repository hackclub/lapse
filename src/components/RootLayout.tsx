import Head from "next/head";
import localFont from "next/font/local";

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

      <div className={`min-h-screen text-foreground bg-background ${phantomSans.className}`}>
        <header className="shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center">
                <h1 className="text-xl font-semibold">Lapse</h1>
              </div>
            </div>
          </div>
        </header>
        
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </>
  );
}
