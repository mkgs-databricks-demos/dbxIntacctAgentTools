/**
 * Vitest suite for the TenantRegistry.
 *
 * Mocks pg.Pool#query and exercises the registry's read/write paths +
 * the in-memory cache TTL behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { TenantRegistry } from '../server/lakebase/tenant_registry.js';

const SAMPLE_ROW = {
  tenant_id: 'acmecorp',
  company_id: 'acmecorp',
  display_name: 'Acme Corp',
  user_secret_key: 'intacct_user_acmecorp',
  password_secret_key: 'intacct_password_acmecorp',
  enabled: true,
  writes_enabled: false,
  notes: null,
  created_at: new Date('2026-04-01'),
  updated_at: new Date('2026-04-25'),
};

function rowResult<T extends object>(rows: T[]): QueryResult<T> {
  return {
    rows,
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  } as unknown as QueryResult<T>;
}

function mockPool(query: ReturnType<typeof vi.fn>): Pool {
  return { query } as unknown as Pool;
}

describe('TenantRegistry.get', () => {
  it('returns null when the tenant is missing', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([]));
    const registry = new TenantRegistry(mockPool(query));

    expect(await registry.get('nope')).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('hydrates the cache and serves repeat reads from it', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([SAMPLE_ROW]));
    const registry = new TenantRegistry(mockPool(query));

    const first = await registry.get('acmecorp');
    const second = await registry.get('acmecorp');

    expect(first?.tenantId).toBe('acmecorp');
    expect(second?.tenantId).toBe('acmecorp');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cache after the TTL expires', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([SAMPLE_ROW]));
    let now = 1_000_000;
    const registry = new TenantRegistry(mockPool(query), { now: () => now });

    await registry.get('acmecorp');
    now += 70_000; // past the 60s TTL
    await registry.get('acmecorp');

    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('TenantRegistry.require', () => {
  it('throws when the tenant is missing', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([]));
    const registry = new TenantRegistry(mockPool(query));

    await expect(registry.require('ghost')).rejects.toThrow(/Unknown tenant/);
  });

  it('throws when the tenant is disabled', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([{ ...SAMPLE_ROW, enabled: false }]));
    const registry = new TenantRegistry(mockPool(query));

    await expect(registry.require('acmecorp')).rejects.toThrow(/disabled/);
  });

  it('returns the record when the tenant is enabled', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([SAMPLE_ROW]));
    const registry = new TenantRegistry(mockPool(query));

    const record = await registry.require('acmecorp');
    expect(record.companyId).toBe('acmecorp');
    expect(record.writesEnabled).toBe(false);
  });
});

describe('TenantRegistry.requireWritable', () => {
  it('throws when writes_enabled is false', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([SAMPLE_ROW]));
    const registry = new TenantRegistry(mockPool(query));

    await expect(registry.requireWritable('acmecorp')).rejects.toThrow(/writes_enabled=false/);
  });

  it('returns the record when writes_enabled is true', async () => {
    const query = vi
      .fn()
      .mockResolvedValue(rowResult([{ ...SAMPLE_ROW, writes_enabled: true }]));
    const registry = new TenantRegistry(mockPool(query));

    const record = await registry.requireWritable('acmecorp');
    expect(record.writesEnabled).toBe(true);
  });

  it('throws when the tenant is missing', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([]));
    const registry = new TenantRegistry(mockPool(query));

    await expect(registry.requireWritable('ghost')).rejects.toThrow(/Unknown tenant/);
  });

  it('throws when the tenant is disabled', async () => {
    const query = vi
      .fn()
      .mockResolvedValue(rowResult([{ ...SAMPLE_ROW, enabled: false, writes_enabled: true }]));
    const registry = new TenantRegistry(mockPool(query));

    await expect(registry.requireWritable('acmecorp')).rejects.toThrow(/disabled/);
  });
});

describe('TenantRegistry.upsert', () => {
  it('writes the row and invalidates the cache', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(rowResult([SAMPLE_ROW])) // initial get
      .mockResolvedValueOnce(rowResult([{ ...SAMPLE_ROW, display_name: 'Acme Corp 2' }])); // upsert
    const registry = new TenantRegistry(mockPool(query));

    await registry.get('acmecorp'); // primes cache
    const updated = await registry.upsert({
      tenantId: 'acmecorp',
      companyId: 'acmecorp',
      displayName: 'Acme Corp 2',
    });

    expect(updated.displayName).toBe('Acme Corp 2');
    // Next get must miss the cache and re-query
    query.mockResolvedValueOnce(rowResult([{ ...SAMPLE_ROW, display_name: 'Acme Corp 2' }]));
    await registry.get('acmecorp');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('defaults user_secret_key and password_secret_key when omitted', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([SAMPLE_ROW]));
    const registry = new TenantRegistry(mockPool(query));

    await registry.upsert({
      tenantId: 'acmecorp',
      companyId: 'acmecorp',
      displayName: 'Acme Corp',
    });

    const args = query.mock.calls[0][1] as unknown[];
    expect(args[3]).toBe('intacct_user_acmecorp');
    expect(args[4]).toBe('intacct_password_acmecorp');
  });

  it('defaults writes_enabled to false when omitted', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([SAMPLE_ROW]));
    const registry = new TenantRegistry(mockPool(query));

    await registry.upsert({
      tenantId: 'acmecorp',
      companyId: 'acmecorp',
      displayName: 'Acme Corp',
    });

    const args = query.mock.calls[0][1] as unknown[];
    // Argument order: [tenantId, companyId, displayName, userKey, passwordKey,
    //                  enabled, writesEnabled, notes]
    expect(args[6]).toBe(false);
  });

  it('forwards writes_enabled when set', async () => {
    const query = vi
      .fn()
      .mockResolvedValue(rowResult([{ ...SAMPLE_ROW, writes_enabled: true }]));
    const registry = new TenantRegistry(mockPool(query));

    const result = await registry.upsert({
      tenantId: 'acmecorp',
      companyId: 'acmecorp',
      displayName: 'Acme Corp',
      writesEnabled: true,
    });

    expect(result.writesEnabled).toBe(true);
    const args = query.mock.calls[0][1] as unknown[];
    expect(args[6]).toBe(true);
  });
});

describe('TenantRegistry.disable', () => {
  it('flips enabled=false and invalidates the cache', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(rowResult([SAMPLE_ROW])) // prime cache
      .mockResolvedValueOnce(rowResult([{ ...SAMPLE_ROW, enabled: false }])); // disable
    const registry = new TenantRegistry(mockPool(query));

    await registry.get('acmecorp');
    const result = await registry.disable('acmecorp');

    expect(result?.enabled).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns null when no row matched', async () => {
    const query = vi.fn().mockResolvedValue(rowResult([]));
    const registry = new TenantRegistry(mockPool(query));

    expect(await registry.disable('ghost')).toBeNull();
  });
});
