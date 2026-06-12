import type { JsonifiedClient } from "@orpc/openapi-client";
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCClient, onError } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { compositeRouterContract } from "@hackclub/lapse-api";
import * as tus from "tus-js-client";
import { invoke } from "@tauri-apps/api/core";

const API_URL = "https://api.lapse.hackclub.com";

const link = new OpenAPILink(compositeRouterContract, {
  url: `${API_URL}/api`,
  headers: async () => {
    const token = await invoke<string | null>("auth_get_token");
    return {
      Authorization: token ? `Bearer ${token}` : undefined,
    };
  },
  interceptors: [
    onError((error: unknown) => {
      console.error("API error:", error);
    }),
  ],
});

export const api: JsonifiedClient<
  ContractRouterClient<typeof compositeRouterContract>
> = createORPCClient(link);

export async function apiUpload(
  token: string,
  data: Blob,
  onProgress?: (uploaded: number, total: number) => void
) {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(data, {
      endpoint: `${API_URL}/upload`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${token}`,
      },
      onProgress,
      onSuccess() {
        resolve();
      },
      onError(error) {
        console.error("Upload failed:", error);
        reject(error);
      },
    });

    upload.start();
  });
}
