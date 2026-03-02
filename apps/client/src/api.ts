import type { JsonifiedClient } from "@orpc/openapi-client";
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCClient, onError } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { compositeRouterContract } from "@hackclub/lapse-api";

const link = new OpenAPILink(compositeRouterContract, {
  url: process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com",
  headers: () => {
    const token = localStorage.getItem("lapse:token");
    
    return {
      "Authorization": token ? `Bearer ${btoa(token)}` : undefined,
    };
  },
  fetch: (request, init) => {
    return globalThis.fetch(request, {
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
