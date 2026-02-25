# Hack Club Lapse API
This package defines the OpenAPI-compatible oRPC contracts that are guaranteed to be fulfilled by the Lapse server.

In order to use the contracts in this package, you'll first have to install the oRPC client:
```sh
# Use whichever package manager you fancy. npm is used as an example!
npm install @orpc/openapi
```

...then, create a standard `OpenAPILink` client:

```typescript
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { ContractRouterClient } from '@orpc/contract'
import { createORPCClient, onError } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'

// You'll need an OAuth token obtained from the canonical client to get access to a user account.

const link = new OpenAPILink(contract, {
  url: "https://api.lapse.hackclub.com", // or localhost for local development
  headers: () => ({
    "Authorization": `Bearer ${TOKEN}`,
  }),
  fetch: (request, init) => {
    return globalThis.fetch(request, {
      ...init,
      credentials: 'include', // Include cookies for cross-origin requests
    });
  },
  interceptors: [
    onError((error) => {
      console.error(error)
    });
  ],
});

const client: JsonifiedClient<ContractRouterClient<typeof contract>> = createORPCClient(link);
```