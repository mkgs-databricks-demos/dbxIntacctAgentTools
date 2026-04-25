/**
 * Tenant registry — one row per Sage Intacct company the MCP serves.
 *
 * The registry is the source of truth for:
 *   - whether a tenant_id is valid (loadTenant() consults it)
 *   - the secret-scope key names that hold the tenant's WS user creds
 *   - admin metadata (display name, notes, enabled flag)
 *
 * A short in-memory cache (60s TTL) collapses repeated reads from the
 * MCP hot path; the cache is keyed on tenant_id and invalidated by
 * any local upsert/disable. The cache is best-effort — a stale read
 * for ≤60s won't break anything (the secret read still happens fresh).
 */

import type { Pool } from 'pg';

export interface TenantRecord {
  tenantId: string;
  companyId: string;
  displayName: string;
  userSecretKey: string;
  passwordSecretKey: string;
  enabled: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantUpsertInput {
  tenantId: string;
  companyId: string;
  displayName: string;
  userSecretKey?: string;
  passwordSecretKey?: string;
  enabled?: boolean;
  notes?: string | null;
}

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  record: TenantRecord | null; // null = "we looked, nothing there"
  expiresAt: number;
}

interface RegistryRow {
  tenant_id: string;
  company_id: string;
  display_name: string;
  user_secret_key: string;
  password_secret_key: string;
  enabled: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export class TenantRegistry {
  private readonly pool: Pool;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly nowFn: () => number;

  constructor(pool: Pool, opts: { now?: () => number } = {}) {
    this.pool = pool;
    this.nowFn = opts.now ?? (() => Date.now());
  }

  /** Look up one tenant by its tenant_id (cached). */
  async get(tenantId: string): Promise<TenantRecord | null> {
    const now = this.nowFn();
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > now) {
      return cached.record;
    }

    const result = await this.pool.query<RegistryRow>(
      `SELECT tenant_id, company_id, display_name, user_secret_key, password_secret_key,
              enabled, notes, created_at, updated_at
         FROM tenant_registry
        WHERE tenant_id = $1`,
      [tenantId],
    );

    const record = result.rows[0] ? rowToRecord(result.rows[0]) : null;
    this.cache.set(tenantId, { record, expiresAt: now + CACHE_TTL_MS });
    return record;
  }

  /** Resolve a tenant for the MCP hot path; throws if missing or disabled. */
  async require(tenantId: string): Promise<TenantRecord> {
    const record = await this.get(tenantId);
    if (!record) {
      throw new Error(`Unknown tenant: '${tenantId}' is not in the registry`);
    }
    if (!record.enabled) {
      throw new Error(`Tenant '${tenantId}' is disabled in the registry`);
    }
    return record;
  }

  /** List every tenant. Bypasses the cache. */
  async list(): Promise<TenantRecord[]> {
    const result = await this.pool.query<RegistryRow>(
      `SELECT tenant_id, company_id, display_name, user_secret_key, password_secret_key,
              enabled, notes, created_at, updated_at
         FROM tenant_registry
        ORDER BY display_name`,
    );
    return result.rows.map(rowToRecord);
  }

  /** Insert or update a tenant. Returns the resulting record. */
  async upsert(input: TenantUpsertInput): Promise<TenantRecord> {
    const userKey = input.userSecretKey ?? `intacct_user_${input.companyId}`;
    const passwordKey = input.passwordSecretKey ?? `intacct_password_${input.companyId}`;
    const enabled = input.enabled ?? true;

    const result = await this.pool.query<RegistryRow>(
      `
      INSERT INTO tenant_registry
        (tenant_id, company_id, display_name, user_secret_key,
         password_secret_key, enabled, notes, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        company_id          = EXCLUDED.company_id,
        display_name        = EXCLUDED.display_name,
        user_secret_key     = EXCLUDED.user_secret_key,
        password_secret_key = EXCLUDED.password_secret_key,
        enabled             = EXCLUDED.enabled,
        notes               = EXCLUDED.notes,
        updated_at          = NOW()
      RETURNING tenant_id, company_id, display_name, user_secret_key,
                password_secret_key, enabled, notes, created_at, updated_at
      `,
      [
        input.tenantId,
        input.companyId,
        input.displayName,
        userKey,
        passwordKey,
        enabled,
        input.notes ?? null,
      ],
    );

    this.cache.delete(input.tenantId);
    if (!result.rows[0]) {
      throw new Error(`upsert returned no row for tenant '${input.tenantId}'`);
    }
    return rowToRecord(result.rows[0]);
  }

  /** Disable a tenant (soft-delete). Returns the resulting record. */
  async disable(tenantId: string): Promise<TenantRecord | null> {
    const result = await this.pool.query<RegistryRow>(
      `UPDATE tenant_registry
          SET enabled = false, updated_at = NOW()
        WHERE tenant_id = $1
       RETURNING tenant_id, company_id, display_name, user_secret_key,
                 password_secret_key, enabled, notes, created_at, updated_at`,
      [tenantId],
    );
    this.cache.delete(tenantId);
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  /** Test-only: clear the in-memory cache. */
  _clearCache(): void {
    this.cache.clear();
  }
}

function rowToRecord(row: RegistryRow): TenantRecord {
  return {
    tenantId: row.tenant_id,
    companyId: row.company_id,
    displayName: row.display_name,
    userSecretKey: row.user_secret_key,
    passwordSecretKey: row.password_secret_key,
    enabled: row.enabled,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
