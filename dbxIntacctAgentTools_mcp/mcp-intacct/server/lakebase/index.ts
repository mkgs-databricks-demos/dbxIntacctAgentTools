/**
 * Lakebase services — registry + call log + a process-wide singleton
 * holder so request handlers can resolve them without dependency
 * injection plumbing through six MCP tools.
 *
 * The singleton is set once during app startup (server.ts after
 * createApp() returns) and read by loadTenant() and runTenantCall().
 */

import type { Pool } from 'pg';
import { CallLog } from './mcp_call_log.js';
import { TenantRegistry } from './tenant_registry.js';

export { initSchema } from './schema.js';
export { TenantRegistry, type TenantRecord, type TenantUpsertInput } from './tenant_registry.js';
export { CallLog, type CallLogEntry } from './mcp_call_log.js';

export interface LakebaseServices {
  registry: TenantRegistry;
  callLog: CallLog;
}

let services: LakebaseServices | null = null;

/** Wire the services from an AppKit lakebase pool. Idempotent. */
export function bindLakebase(pool: Pool): LakebaseServices {
  services = {
    registry: new TenantRegistry(pool),
    callLog: new CallLog(pool),
  };
  return services;
}

/**
 * Resolve the bound services. Throws if `bindLakebase()` has not yet
 * been called (server startup ordering bug).
 */
export function getLakebase(): LakebaseServices {
  if (!services) {
    throw new Error(
      'Lakebase services not bound. Call bindLakebase(pool) during app startup before serving requests.',
    );
  }
  return services;
}

/** Test-only: clear the bound services. */
export function _resetLakebase(): void {
  services = null;
}
