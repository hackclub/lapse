import type { JsonifiedClient } from "@orpc/openapi-client";
import type { ContractRouterClient } from "@orpc/contract";
import { createORPCClient, onError } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { compositeRouterContract } from "@hackclub/lapse-api";

// You"ll need an OAuth token obtained from the canonical client to get access to a user account.

const link = new OpenAPILink(compositeRouterContract, {
  url: process.env.NEXT_PUBLIC_API_URL ?? "https://api.lapse.hackclub.com",
  headers: () => ({
    "Authorization": `Bearer ${TOKEN}`,
  }),
  fetch: (request, init) => {
    return globalThis.fetch(request, {
      ...init,
      credentials: "include", // Include cookies for cross-origin requests
    });
  },
  interceptors: [
    onError((error) => {
      console.error(error)
    });
  ],
});

const client: JsonifiedClient<ContractRouterClient<typeof contract>> = createORPCClient(link);