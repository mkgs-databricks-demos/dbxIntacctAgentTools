/**
 * tRPC request context.
 *
 * The context resolves the bound Lakebase services (registry + call log)
 * lazily so tests can swap implementations via dependency injection,
 * and resolves the request identity (user + admin flag) from the
 * `x-forwarded-user` header on every call.
 */

import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { resolveIdentity, type RequestIdentity } from './auth.js';
import { getLakebase, type LakebaseServices } from '../lakebase/index.js';

export interface TrpcContext {
  lakebase: LakebaseServices;
  identity: RequestIdentity;
}

export function createContext(opts: CreateExpressContextOptions): TrpcContext {
  return {
    lakebase: getLakebase(),
    identity: resolveIdentity(opts.req),
  };
}

/** Test helper — build a context with a custom Lakebase + identity. */
export function createTestContext(
  lakebase: LakebaseServices,
  identity: Partial<RequestIdentity> = {},
): TrpcContext {
  return {
    lakebase,
    identity: {
      userId: null,
      isAdmin: false,
      isAuthenticated: false,
      ...identity,
    },
  };
}
