import { useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/router";
import type { LapseError } from "@hackclub/lapse-api";

import RootLayout from "@/components/layout/RootLayout";
import { Bullet } from "@/components/ui/Bullet";

/**
 * Everything needed to tell the user why they can't see what they were after. The `status` is the HTTP status the
 * situation corresponds to - it isn't always one we literally received, but people recognize the numbers.
 */
export interface PageStatus {
  status: number;
  title: string;
  message: string;
}

export const NOT_FOUND_STATUS: PageStatus = {
  status: 404,
  title: "There's nothing here",
  message: "This page doesn't exist. It may have been deleted, or the link that brought you here might be wrong."
};

export const FORBIDDEN_STATUS: PageStatus = {
  status: 403,
  title: "This isn't for you",
  message: "You don't have access to this. If it belongs to someone else, they'd have to make it public first."
};

export const SERVER_ERROR_STATUS: PageStatus = {
  status: 500,
  title: "Something broke on our end",
  message: "This one is our fault. Try again in a moment - if it keeps happening, let us know."
};

/**
 * Translates an API error into something worth putting on a page. `message` overrides the default copy when the
 * server had something more specific to say.
 */
export function statusForApiError(error: LapseError, message?: string): PageStatus {
  const base =
    (error === "NOT_FOUND" || error === "DEVICE_NOT_FOUND" || error === "NO_FILE") ? NOT_FOUND_STATUS :
    (error === "NO_PERMISSION") ? FORBIDDEN_STATUS :
    (error === "EXPIRED") ? {
      status: 410,
      title: "This has expired",
      message: "Whatever was here isn't available anymore."
    } :
    (error === "ALREADY_PUBLISHED" || error === "NOT_MUTABLE") ? {
      status: 409,
      title: "Too late for that",
      message: "This has already been dealt with, and can't be changed anymore."
    } :
    SERVER_ERROR_STATUS;

  return message ? { ...base, message } : base;
}

const LINK_CLASS = "underline underline-offset-4 hover:text-red transition-colors cursor-pointer";

/**
 * A full-page stand-in for a page we couldn't show - a 404 from the router, or an entity the API wouldn't hand
 * over. It's deliberately just words: a dead end is a bad place to put an interface in front of someone.
 */
export function StatusPage({ status, title, message }: PageStatus) {
  const router = useRouter();

  // Someone who opened a dead link directly has nothing to go back to, and the link would do nothing at all.
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => setCanGoBack(window.history.length > 1), []);

  return (
    <RootLayout title={`${status} - Lapse`} description={title} showHeader>
      <div className="min-h-full flex flex-col items-center justify-center px-8 py-16 sm:px-16">
        <div className="flex flex-col items-center text-center gap-6 max-w-xl">
          <span className="font-mono font-bold text-red text-7xl sm:text-8xl tracking-tighter leading-none">
            {status}
          </span>

          <div className="flex flex-col gap-3">
            <h1 className="m-0 text-2xl sm:text-3xl font-bold wrap-break-word">{title}</h1>
            <p className="text-muted wrap-break-word">{message}</p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 text-smoke">
            <NextLink href="/" className={LINK_CLASS}>Go home</NextLink>

            {canGoBack && (
              <>
                <span className="text-slate"><Bullet /></span>
                <button type="button" onClick={() => router.back()} className={LINK_CLASS}>
                  Go back
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </RootLayout>
  );
}
