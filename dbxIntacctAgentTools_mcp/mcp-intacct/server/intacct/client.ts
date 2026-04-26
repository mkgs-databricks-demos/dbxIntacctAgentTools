/**
 * High-level Sage Intacct REST client.
 *
 * Mirrors intacct_sdk/client.py — wraps low-level HTTP with:
 *   - Token-cached IntacctAuth
 *   - Per-tenant credential resolution (loadTenant from credentials.ts)
 *   - Pagination over readByQuery / list endpoints
 *   - Error mapping (401 → AuthError, 404 → NotFoundError, 429 →
 *     RateLimitError, 5xx → ServerError)
 *
 * The TS client is opinionated and exposes a curated set of read methods.
 * Drop down to ``request()`` for endpoints not surfaced here.
 */

import { IntacctAuth } from './auth.js';
import { loadTenant, type IntacctCredentials } from './credentials.js';
import {
  AuthError,
  IntacctError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from './errors.js';
import { collect, paginate, type PaginateOptions } from './pagination.js';

const DEFAULT_BASE_URL = 'https://api.intacct.com/ia/api/v1';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface IntacctClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  /**
   * Optional hook for raw-response capture (UC volume writeback, etc.).
   * Called once per request after the response body has been read.
   */
  onRawResponse?: (capture: RawResponseCapture) => Promise<void> | void;
}

export interface RawResponseCapture {
  requestId: string;
  tenantId: string;
  method: string;
  path: string;
  httpStatus: number;
  body: unknown;
  capturedAt: string;
}

interface PaginatedBody {
  ['ia::result']?: unknown[];
  next_cursor?: string | null;
}

/** High-level Sage Intacct REST client for one tenant. */
export class IntacctClient {
  readonly auth: IntacctAuth;
  readonly tenantId: string;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly onRawResponse?: (capture: RawResponseCapture) => Promise<void> | void;

  constructor(credentials: IntacctCredentials, opts: IntacctClientOptions = {}) {
    // Thread the optional fetch override through to IntacctAuth so tests
    // can stub the OAuth token exchange and the REST calls with one mock.
    this.auth = new IntacctAuth(credentials, opts.fetch ? { fetch: opts.fetch } : {});
    this.tenantId = credentials.companyId;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.onRawResponse = opts.onRawResponse;
  }

  /** Build a client by resolving credentials for the given Sage company. */
  static async forTenant(
    companyId: string,
    opts: IntacctClientOptions = {},
  ): Promise<IntacctClient> {
    const creds = await loadTenant(companyId);
    return new IntacctClient(creds, opts);
  }

  // -------------------------------------------------------------------
  // Low-level
  // -------------------------------------------------------------------
  async request<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    opts: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      /** Forwarded as the `Idempotency-Key` HTTP header on writes. */
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, '')}`);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const requestId = randomId();
    const headers = await this.auth.authorize({
      'X-Intacct-Request-Id': requestId,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let resp: Response;
    try {
      resp = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const body = await safeJson(resp);

    if (this.onRawResponse) {
      await this.onRawResponse({
        requestId,
        tenantId: this.tenantId,
        method,
        path,
        httpStatus: resp.status,
        body,
        capturedAt: new Date().toISOString(),
      });
    }

    if (resp.status === 401) {
      this.auth.invalidate();
      throw new AuthError('401 Unauthorized — token invalidated', { statusCode: 401, payload: body });
    }
    if (resp.status === 404) {
      throw new NotFoundError(`Not found: ${method} ${path}`, { statusCode: 404, payload: body });
    }
    if (resp.status === 429) {
      throw new RateLimitError('429 Too Many Requests', { statusCode: 429, payload: body });
    }
    if (resp.status >= 500 && resp.status < 600) {
      throw new ServerError(`5xx from Intacct: ${resp.status}`, { statusCode: resp.status, payload: body });
    }
    if (!resp.ok) {
      throw new IntacctError(`Unexpected ${resp.status} from Intacct`, {
        statusCode: resp.status,
        payload: body,
      });
    }

    return (body ?? {}) as T;
  }

  // -------------------------------------------------------------------
  // Paginated reads
  // -------------------------------------------------------------------
  list<T = Record<string, unknown>>(
    path: string,
    opts: { params?: Record<string, string | number | boolean | undefined> } & PaginateOptions = {},
  ): AsyncIterableIterator<T> {
    const { maxPages, maxResults, params } = opts;

    const fetchPage = async (cursor: string | null) => {
      const local = { ...(params ?? {}) };
      if (cursor !== null && cursor !== '') {
        local.cursor = cursor;
      }
      const body = (await this.request<PaginatedBody>('GET', path, { params: local })) ?? {};
      return {
        items: (body['ia::result'] ?? []) as T[],
        nextCursor: body.next_cursor ?? null,
      };
    };

    return paginate(fetchPage, { maxPages, maxResults });
  }

  // -------------------------------------------------------------------
  // Curated convenience methods (extend as the MCP tool surface grows)
  // -------------------------------------------------------------------
  async listGlAccounts(
    filters: { accountNoPrefix?: string; modifiedSince?: string; maxResults?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string | number | undefined> = {};
    if (filters.accountNoPrefix) {
      params['filter[account_no][startswith]'] = filters.accountNoPrefix;
    }
    if (filters.modifiedSince) {
      params['filter[modified_at][gt]'] = filters.modifiedSince;
    }
    return collect(
      this.list('objects/general-ledger/account', { params, maxResults: filters.maxResults }),
      filters.maxResults,
    );
  }

  async getJournalEntry(journalEntryId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', `objects/general-ledger/journal-entry/${journalEntryId}`);
  }

  async queryGlDetails(
    args: {
      startDate: string;
      endDate: string;
      accountNoPrefix?: string;
      maxResults?: number;
    },
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string | number> = {
      'filter[posting_date][gte]': args.startDate,
      'filter[posting_date][lte]': args.endDate,
    };
    if (args.accountNoPrefix) {
      params['filter[account_no][startswith]'] = args.accountNoPrefix;
    }
    return collect(
      this.list('objects/general-ledger/general-ledger-detail', {
        params,
        maxResults: args.maxResults,
      }),
      args.maxResults,
    );
  }

  async listCustomers(
    filters: { nameContains?: string; maxResults?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string | number | undefined> = {};
    if (filters.nameContains) {
      params['filter[name][contains]'] = filters.nameContains;
    }
    return collect(
      this.list('objects/accounts-receivable/customer', { params, maxResults: filters.maxResults }),
      filters.maxResults,
    );
  }

  async listOpenInvoices(
    filters: {
      customerId?: string;
      agingBucket?: 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
      maxResults?: number;
    } = {},
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string | number | undefined> = {
      'filter[state][eq]': 'open',
    };
    if (filters.customerId) {
      params['filter[customer_id][eq]'] = filters.customerId;
    }
    if (filters.agingBucket) {
      params['filter[aging_bucket][eq]'] = filters.agingBucket;
    }
    return collect(
      this.list('objects/accounts-receivable/invoice', { params, maxResults: filters.maxResults }),
      filters.maxResults,
    );
  }

  async getCustomerBalance(customerId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'GET',
      `objects/accounts-receivable/customer/${customerId}/balance`,
    );
  }

  // ── Accounts Payable ────────────────────────────────────────────────
  async listVendors(
    filters: { nameContains?: string; status?: 'active' | 'inactive'; maxResults?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string | number | undefined> = {};
    if (filters.nameContains) {
      params['filter[name][contains]'] = filters.nameContains;
    }
    if (filters.status) {
      params['filter[status][eq]'] = filters.status;
    }
    return collect(
      this.list('objects/accounts-payable/vendor', { params, maxResults: filters.maxResults }),
      filters.maxResults,
    );
  }

  async listBills(
    filters: {
      vendorId?: string;
      state?: 'open' | 'partially_paid' | 'paid';
      postedSince?: string;
      maxResults?: number;
    } = {},
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string | number | undefined> = {};
    if (filters.vendorId) {
      params['filter[vendor_id][eq]'] = filters.vendorId;
    }
    if (filters.state) {
      params['filter[state][eq]'] = filters.state;
    }
    if (filters.postedSince) {
      params['filter[posting_date][gte]'] = filters.postedSince;
    }
    return collect(
      this.list('objects/accounts-payable/bill', { params, maxResults: filters.maxResults }),
      filters.maxResults,
    );
  }

  // ── Cash Management ─────────────────────────────────────────────────
  async listPayments(
    filters: {
      direction?: 'in' | 'out';
      startDate?: string;
      endDate?: string;
      accountId?: string;
      maxResults?: number;
    } = {},
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string | number | undefined> = {};
    if (filters.direction) {
      params['filter[direction][eq]'] = filters.direction;
    }
    if (filters.startDate) {
      params['filter[payment_date][gte]'] = filters.startDate;
    }
    if (filters.endDate) {
      params['filter[payment_date][lte]'] = filters.endDate;
    }
    if (filters.accountId) {
      params['filter[account_id][eq]'] = filters.accountId;
    }
    return collect(
      this.list('objects/cash-management/payment', { params, maxResults: filters.maxResults }),
      filters.maxResults,
    );
  }

  /**
   * Cash position roll-up across all configured cash accounts as of `asOfDate`
   * (defaults to today). Returns one row per account with end-of-day balance.
   */
  async getCashPosition(args: { asOfDate?: string } = {}): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {};
    if (args.asOfDate) {
      params['as_of'] = args.asOfDate;
    }
    return this.request<Record<string, unknown>>(
      'GET',
      'objects/cash-management/cash-position',
      { params },
    );
  }

  // ── Write-path methods ──────────────────────────────────────────────
  // All writes accept an optional idempotency_key — forwarded as the
  // `Idempotency-Key` HTTP header so retries against Sage are safe.

  /**
   * Post a journal entry. The body shape mirrors Sage REST's expected
   * payload: { posting_date, description?, lines: [{ account_no, amount,
   * debit_credit, memo?, dimensions? }] }.
   */
  async postJournalEntry(
    entry: {
      posting_date: string;
      description?: string;
      lines: Array<{
        account_no: string;
        amount: number;
        debit_credit: 'debit' | 'credit';
        memo?: string;
        dimensions?: Record<string, string | number>;
      }>;
    },
    opts: { idempotencyKey?: string } = {},
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'POST',
      'objects/general-ledger/journal-entry',
      { body: entry, idempotencyKey: opts.idempotencyKey },
    );
  }

  /** Record an AR adjustment against a specific charge line. */
  async recordAdjustment(
    args: {
      charge_line_id: string;
      adjustment_date: string;
      adjustment_type: string;
      adjustment_reason_code?: string;
      amount: number;
      memo?: string;
    },
    opts: { idempotencyKey?: string } = {},
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'POST',
      'objects/accounts-receivable/adjustment',
      { body: args, idempotencyKey: opts.idempotencyKey },
    );
  }

  /**
   * Apply a payment to one or more open AR invoices. Accepts a payment
   * with line-level applications (invoice_id + amount per line).
   */
  async applyPayment(
    args: {
      payer_id: string;
      payment_date: string;
      payment_method: string;
      account_id: string;
      amount: number;
      applications: Array<{ invoice_id: string; amount: number }>;
      memo?: string;
    },
    opts: { idempotencyKey?: string } = {},
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      'POST',
      'objects/accounts-receivable/payment',
      { body: args, idempotencyKey: opts.idempotencyKey },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function safeJson(resp: Response): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    try {
      return await resp.text();
    } catch {
      return undefined;
    }
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
