/**
 * Mount the tRPC router onto the AppKit Express app at /api/trpc.
 *
 * Called from server.ts after createApp() returns and the Lakebase
 * services have been bound.
 */

import type { Application } from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './router.js';
import { createContext } from './context.js';

export const TRPC_ENDPOINT = '/api/trpc';

export function mountTrpc(app: Application): void {
  app.use(
    TRPC_ENDPOINT,
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );
}
