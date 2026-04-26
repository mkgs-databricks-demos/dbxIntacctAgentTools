/**
 * Vitest suite for the AP + Cash client methods.
 *
 * Mocks `fetch` end-to-end and verifies:
 *   - the method hits the right path
 *   - filters land as the expected query parameters (Sage's
 *     filter[<field>][<op>] convention)
 *   - pagination collects across multiple pages
 *   - point reads (getCashPosition) flow through cleanly
 */

import { describe, it, expect, vi } from 'vitest';
import { IntacctClient } from '../server/intacct/client.js';
import type { IntacctCredentials } from '../server/intacct/credentials.js';

const creds: IntacctCredentials = {
  senderId: 'SENDER',
  senderPassword: 'senderpw',
  companyId: 'acmecorp',
  wsUserId: 'ws_user',
  wsUserPassword: 'ws_pw',
};

function buildResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Build a fetch mock that returns:
 *   - the OAuth token on the auth endpoint
 *   - one of the supplied REST responses per call to api.intacct.com/ia/api/v1
 */
function makeFetch(restResponses: Response[]): ReturnType<typeof vi.fn> {
  const queue = [...restResponses];
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.endsWith('/oauth2/token')) {
      return Promise.resolve(buildResponse({ access_token: 'tok', expires_in: 3600 }));
    }
    const next = queue.shift();
    if (!next) {
      throw new Error(`No more queued responses; called ${url}`);
    }
    return Promise.resolve(next);
  });
}

describe('IntacctClient.listVendors', () => {
  it('paginates across pages and forwards filters', async () => {
    const fetchMock = makeFetch([
      buildResponse({
        'ia::result': [{ id: '1', name: 'Acme Inc' }],
        next_cursor: 'page2',
      }),
      buildResponse({
        'ia::result': [{ id: '2', name: 'Beta Co' }],
        next_cursor: null,
      }),
    ]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    const result = await client.listVendors({ nameContains: 'co', status: 'active' });

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('1');
    // 1 auth + 2 rest pages = 3 fetch calls
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstUrl = String(fetchMock.mock.calls[1][0]);
    expect(firstUrl).toContain('/objects/accounts-payable/vendor');
    expect(firstUrl).toContain('filter%5Bname%5D%5Bcontains%5D=co');
    expect(firstUrl).toContain('filter%5Bstatus%5D%5Beq%5D=active');
  });

  it('respects maxResults', async () => {
    const fetchMock = makeFetch([
      buildResponse({
        'ia::result': [
          { id: '1' },
          { id: '2' },
          { id: '3' },
        ],
        next_cursor: null,
      }),
    ]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    const result = await client.listVendors({ maxResults: 2 });
    expect(result).toHaveLength(2);
  });
});

describe('IntacctClient.listBills', () => {
  it('forwards vendor + state + posted_since as filter params', async () => {
    const fetchMock = makeFetch([
      buildResponse({ 'ia::result': [{ id: 'b1' }], next_cursor: null }),
    ]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    await client.listBills({
      vendorId: 'v1',
      state: 'open',
      postedSince: '2026-04-01',
    });

    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain('/objects/accounts-payable/bill');
    expect(url).toContain('filter%5Bvendor_id%5D%5Beq%5D=v1');
    expect(url).toContain('filter%5Bstate%5D%5Beq%5D=open');
    expect(url).toContain('filter%5Bposting_date%5D%5Bgte%5D=2026-04-01');
  });
});

describe('IntacctClient.listPayments', () => {
  it('forwards direction + date range + accountId', async () => {
    const fetchMock = makeFetch([
      buildResponse({ 'ia::result': [{ id: 'p1' }], next_cursor: null }),
    ]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    await client.listPayments({
      direction: 'in',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      accountId: 'acct-1',
    });

    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain('/objects/cash-management/payment');
    expect(url).toContain('filter%5Bdirection%5D%5Beq%5D=in');
    expect(url).toContain('filter%5Bpayment_date%5D%5Bgte%5D=2026-04-01');
    expect(url).toContain('filter%5Bpayment_date%5D%5Blte%5D=2026-04-30');
    expect(url).toContain('filter%5Baccount_id%5D%5Beq%5D=acct-1');
  });

  it('omits all filters when none provided', async () => {
    const fetchMock = makeFetch([
      buildResponse({ 'ia::result': [], next_cursor: null }),
    ]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    await client.listPayments();

    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain('/objects/cash-management/payment');
    expect(url).not.toContain('filter');
  });
});

describe('IntacctClient.getCashPosition', () => {
  it('hits the cash-position endpoint without an as_of by default', async () => {
    const fetchMock = makeFetch([
      buildResponse({ accounts: [{ account_id: 'a1', balance: 1000 }] }),
    ]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    const result = await client.getCashPosition();

    expect(result.accounts).toBeDefined();
    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain('/objects/cash-management/cash-position');
    expect(url).not.toContain('as_of=');
  });

  it('forwards as_of when provided', async () => {
    const fetchMock = makeFetch([
      buildResponse({ accounts: [{ account_id: 'a1', balance: 950 }] }),
    ]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    await client.getCashPosition({ asOfDate: '2026-04-25' });

    const url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain('as_of=2026-04-25');
  });
});
