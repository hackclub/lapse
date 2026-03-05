import type { JsonifiedClient } from "@orpc/openapi-client";
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCClient, onError } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { compositeRouterContract } from "@hackclub/lapse-api";
import * as tus from "tus-js-client";
import { sfetch } from "@/safety";

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
      credentials: "include", // Include cookies for cross-origin requests
    });
  },
  interceptors: [
    onError((error) => {
      console.error(error)
    })
  ],
});

/**
 * The main API client.
 */
export const api: JsonifiedClient<ContractRouterClient<typeof compositeRouterContract>> = createORPCClient(link);

/**
 * Handles resumable multipart uploads via `tus`, consuming a single-use upload `token`.
 */
export async function apiUpload(
  token: string,
  data: File | Blob | Buffer,
  onProgress?: (uploaded: number, total: number) => void
) {
  return new Promise<void>(async (resolve, reject) => {
    console.log("(api.ts) beginning upload!", data);

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