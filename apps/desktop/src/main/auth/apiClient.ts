import * as fs from "node:fs";
import type { JsonifiedClient } from "@orpc/openapi-client";
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { compositeRouterContract } from "@hackclub/lapse-api";
import * as tus from "tus-js-client";
import { authService } from "./oauthFlow";

const API_URL = process.env.LAPSE_API_URL ?? "https://api.lapse.hackclub.com";

const link = new OpenAPILink(compositeRouterContract, {
  url: `${API_URL}/api`,
  headers: () => {
    const token = authService.getToken();

    return {
      Authorization: token ? `Bearer ${token}` : undefined
    };
  }
});

/**
 * The main oRPC API client for the Electron main process. Uses the same
 * contracts as the web client (`compositeRouterContract`) so that all
 * type-safe route helpers are available.
 */
export const api: JsonifiedClient<ContractRouterClient<typeof compositeRouterContract>> = createORPCClient(link);

/**
 * Convenience wrapper that exposes common API helpers.
 */
export const apiClient = {
  /**
   * Fetches the currently authenticated user, or `null` if not signed in
   * or the request fails.
   */
  async getUser() {
    const result = await api.user.myself({});
    if ("data" in result && result.data) {
      return (result.data as { user: { id: string; handle: string; displayName: string; profilePictureUrl: string | null } | null }).user;
    }
    return null;
  }
};

/**
 * Handles resumable multipart uploads via `tus`, consuming a single-use
 * upload `token`. Reads a file from disk using `fs.createReadStream` so
 * that large recordings do not need to be buffered entirely in memory.
 */
export async function apiUpload(
  token: string,
  filePath: string,
  onProgress?: (uploaded: number, total: number) => void
): Promise<void> {
  const stat = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);

  return new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const upload = new tus.Upload(stream as any, {
      endpoint: `${API_URL}/upload`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadSize: stat.size,
      headers: {
        authorization: `Bearer ${token}`
      },
      onProgress: onProgress
        ? (bytesUploaded: number, bytesTotal: number) => {
            onProgress(bytesUploaded, bytesTotal);
          }
        : undefined,
      onSuccess() {
        resolve();
      },
      onError(error) {
        console.error("(apiClient.ts) upload failed!", error);
        reject(error);
      }
    });

    upload.start();
  });
}
