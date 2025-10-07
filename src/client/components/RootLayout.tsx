import Head from "next/head";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import Icon from "@hackclub/icons";

import { ReactNode } from "react";
import { Button } from "./ui/Button";
import { ProfilePicture } from "./ui/ProfilePicture";
import { useAuth } from "../hooks/useAuth";
import LapseIcon from "../assets/icon.svg";

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

interface RootLayoutProps {
  children: ReactNode;
  title?: string;
  description?: string;
  showHeader?: boolean;
}

export default function RootLayout({
  children,
  title = "Lapse - Timelapse Recording",
  description = "Create and share timelapses with Hack Club Lapse",
  showHeader = false
}: RootLayoutProps) {
  const { currentUser } = useAuth(false);

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className={`w-full h-full p-6 text-text bg-dark ${jetBrainsMono.variable} ${phantomSans.className}`}>
        {showHeader && (
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <LapseIcon className="w-12 h-12" />
            </div>
            
            <div className="flex items-center gap-4">
              <Link href="/timelapse/create">
                <Button 
                  kind="primary"
                  onClick={() => {}}
                  className="gap-2 px-8"
                >
                  <Icon glyph="plus-fill" size={20} />
                  Create
                </Button>
              </Link>
              {currentUser && (
                <ProfilePicture 
                  profilePictureUrl={currentUser.profilePictureUrl}
                  displayName={currentUser.displayName}
                  size="md"
                />
              )}
            </div>
          </div>
        )}
        
        <main className="w-full h-full">
          {children}
        </main>
      </div>
    </>
  );
}
