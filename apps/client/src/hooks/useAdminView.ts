import { useSyncExternalStore } from "react";
import type { Timelapse } from "@hackclub/lapse-api";

import { useAuthContext } from "@/context/AuthContext";

const HIDE_ADMIN_VIEW_KEY = "lapse:pref.hideAdminView";
const CHANGE_EVENT = "lapse:adminViewChange";

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);

  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

const getSnapshot = () => localStorage.getItem(HIDE_ADMIN_VIEW_KEY) === "true";
const getServerSnapshot = () => false;

/**
 * Hides (or shows again) content admins can only see because of their permissions, on this device. Useful for e.g.
 * screen sharing without leaking unlisted timelapses.
 */
export function setAdminViewHidden(hidden: boolean) {
  if (hidden) {
    localStorage.setItem(HIDE_ADMIN_VIEW_KEY, "true");
  }
  else {
    localStorage.removeItem(HIDE_ADMIN_VIEW_KEY);
  }

  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Describes whether the current user is an admin, and whether admin-only content should be shown to them.
 */
export function useAdminView() {
  const { currentUser } = useAuthContext();
  const hidden = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isAdmin = currentUser !== null && currentUser.private.permissionLevel !== "USER";
  const enabled = isAdmin && !hidden;

  /**
   * Returns `true` if `timelapse` isn't the viewer's, and other users wouldn't be able to discover it.
   */
  function isHiddenFromOthers(timelapse: Timelapse) {
    return (
      currentUser?.id !== timelapse.owner.id &&
      (timelapse.visibility !== "PUBLIC" || (timelapse.playbackUrl === null && timelapse.blocker === null))
    );
  }

  return {
    isAdmin,
    enabled,
    hidden,
    isHiddenFromOthers,

    /**
     * Returns `true` if the viewer is shown `timelapse` only because they're an admin.
     */
    isAdminOnly(timelapse: Timelapse) {
      return enabled && isHiddenFromOthers(timelapse);
    }
  };
}
