import type { JsonifiedClient } from "@orpc/openapi-client";
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCClient, onError } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { compositeRouterContract } from "@hackclub/lapse-api";
import * as tus from "tus-js-client";
import { sfetch } from "@/safety";
import posthog from "posthog-js";

/**
 * The absolute URL at which the API is hosted at.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com";

const link = new OpenAPILink(compositeRouterContract, {
  url: `${API_URL}/api`,
  headers: () => {
    const token = localStorage.getItem("lapse:token");
    
    return {
      "Authorization": token ? `Bearer ${token}` : undefined,
    };
  },
  fetch: (request, init) => {
    return sfetch(request, {
      ...init,
      credentials: "include" // Include cookies for cross-origin requests
    });
  },
  interceptors: [
    onError((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "UNAUTHORIZED") {
        // Our session is invalid (expired/absent token), so send the user to sign in. But NEVER do this
        // while we're already in the auth flow: this `onError` fires for *any* unauthorized request,
        // including background probes (see `_app.tsx`). On `/auth` — especially mid-callback, when the URL
        // carries `?code=...` — a hard redirect to `/auth` wipes the in-flight code exchange and restarts
        // OAuth, trapping the user in an endless redirect loop. We also preserve where they were so they
        // land back there after authenticating instead of getting dumped on the home page.
        if (typeof window === "undefined")
          return;

        const path = window.location.pathname;
        if (path === "/auth" || path.startsWith("/oauth/"))
          return;

        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        location.href = `/auth?redirect=${redirect}`;
      }
      else {
        console.error(error);
        posthog.capture("api_error", { error });
      }
    })
  ],
});

/**
 * The main API client.
 */
export const api: JsonifiedClient<ContractRouterClient<typeof compositeRouterContract>> = createORPCClient(link);

/**
 * Uploads `data` to the server via `tus`, authorized by an upload `token` issued by an endpoint such as
 * `draftTimelapse.create`. Used to recover unfinished (OPFS-stored) legacy recordings by uploading their
 * encrypted sessions and thumbnail.
 */
export async function apiUpload(
  token: string,
  data: File | Blob,
  onProgress?: (uploaded: number, total: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(data, {
      endpoint: `${API_URL}/upload`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${token}`
      },
      onProgress,
      onSuccess() { resolve(); },
      onError(error) {
        console.error("(api.ts) upload failed!", error, data);
        reject(error);
      },
    });

    upload.start();
  });
}

