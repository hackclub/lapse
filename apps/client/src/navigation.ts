import type { MouseEvent } from "react";
import type { NextRouter } from "next/router";

/**
 *  Ctrl + Left Click is my life
 */

export function wantsNewTab(e: MouseEvent) {
  return e.ctrlKey || e.metaKey || e.button === 1;
}

export function navigateTo(router: NextRouter, href: string, e: MouseEvent) {
  if (wantsNewTab(e)) {
    window.open(href, "_blank", "noopener");
    return;
  }

  router.push(href);
}
