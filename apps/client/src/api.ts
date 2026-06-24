import type { JsonifiedClient } from "@orpc/openapi-client";
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCClient, onError } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { compositeRouterContract } from "@hackclub/lapse-api";
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
        location.href = "/auth";
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

