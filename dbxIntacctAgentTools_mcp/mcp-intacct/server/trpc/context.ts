/**
 * tRPC request context.
 *
 * The context resolves the bound Lakebase services (registry + call log)
 * lazily so tests can swap implementations via dependency injection.
 *
 * Future: thread through the user identity from AppKit's getUserContext()
 * to authorize admin-only mutations.
 */

import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { getLakebase, type LakebaseServices } from '../lakebase/index.js';

export interface TrpcContext {
  lakebase: LakebaseServices;
}

export function createContext(
  _opts: CreateExpressContextOptions,
): TrpcContext {
  return {
    lakebase: getLakebase(),
  };
}

/** Test helper — build a context with a custom Lakebase instance. */
export function createTestContext(lakebase: LakebaseServices): TrpcContext {
  return { lakebase };
}
