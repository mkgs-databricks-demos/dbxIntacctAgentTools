/**
 * Typed tRPC client for the mcp-intacct admin UI.
 *
 * Uses `@trpc/react-query` so admin components can call the server via
 * standard react-query hooks (useQuery / useMutation) with full
 * type-safety derived from the server-side AppRouter.
 */

import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import type { AppRouter } from '../../../server/trpc/router.js';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      transformer: superjson,
    }),
  ],
});
