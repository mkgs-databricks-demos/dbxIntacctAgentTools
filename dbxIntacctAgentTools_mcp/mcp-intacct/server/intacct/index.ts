/** Public surface of the TS Sage Intacct client. */

export { IntacctClient } from './client.js';
export type {
  IntacctClientOptions,
  RawResponseCapture,
} from './client.js';
export { IntacctAuth } from './auth.js';
export type { IntacctAuthOptions } from './auth.js';
export { loadTenant } from './credentials.js';
export type { IntacctCredentials } from './credentials.js';
export {
  AuthError,
  IntacctError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from './errors.js';
export { collect, paginate } from './pagination.js';
export type { PageFetcher, PaginateOptions } from './pagination.js';

/**
 * Resolve a per-tenant client. Caches up to N clients to amortize the
 * secret-fetch cost across MCP tool calls within the same session.
 *
 * Tokens inside each cached client also auto-refresh, so the cache
 * survives token rotation without any extra coordination.
 */
import { IntacctClient } from './client.js';
import type { IntacctClientOptions } from './client.js';

const TENANT_CLIENTS = new Map<string, IntacctClient>();
const MAX_CACHED_TENANTS = 32;

export async function getTenantClient(
  tenantId: string,
  opts: IntacctClientOptions = {},
): Promise<IntacctClient> {
  const cached = TENANT_CLIENTS.get(tenantId);
  if (cached) {
    return cached;
  }
  const client = await IntacctClient.forTenant(tenantId, opts);
  if (TENANT_CLIENTS.size >= MAX_CACHED_TENANTS) {
    // Evict the oldest entry (Map iteration is insertion-ordered)
    const oldest = TENANT_CLIENTS.keys().next().value;
    if (oldest) {
      TENANT_CLIENTS.delete(oldest);
    }
  }
  TENANT_CLIENTS.set(tenantId, client);
  return client;
}

/** Test-only: clear the per-tenant client cache. */
export function _resetTenantClientCache(): void {
  TENANT_CLIENTS.clear();
}
