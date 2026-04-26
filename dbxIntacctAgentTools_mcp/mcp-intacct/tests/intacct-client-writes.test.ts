/**
 * Vitest suite for the IntacctClient write-path methods.
 *
 * Mocks `fetch` end-to-end and verifies:
 *   - the right method + path
 *   - body forwards every payload field
 *   - Idempotency-Key header is set when idempotency_key is provided
 *   - the absence of an idempotency_key skips the header
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

function makeFetch(restResponses: Response[]): ReturnType<typeof vi.fn> {
  const queue = [...restResponses];
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.endsWith('/oauth2/token')) {
      return Promise.resolve(buildResponse({ access_token: 'tok', expires_in: 3600 }));
    }
    const next = queue.shift();
    if (!next) throw new Error(`No more queued responses; called ${url}`);
    return Promise.resolve(next);
  });
}

function getInit(call: unknown[]): RequestInit {
  return call[1] as RequestInit;
}

function getHeaderValue(init: RequestInit, name: string): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  if (!headers) return undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return undefined;
}

describe('IntacctClient.postJournalEntry', () => {
  it('POSTs to objects/general-ledger/journal-entry with the payload', async () => {
    const fetchMock = makeFetch([buildResponse({ id: 'je-1', state: 'posted' })]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    const result = await client.postJournalEntry({
      posting_date: '2026-04-26',
      description: 'monthly close adj',
      lines: [
        { account_no: '4100', amount: 1000, debit_credit: 'credit' },
        { account_no: '1000', amount: 1000, debit_credit: 'debit' },
      ],
    });

    expect(result.id).toBe('je-1');

    const restCall = fetchMock.mock.calls[1];
    expect(String(restCall[0])).toContain('/objects/general-ledger/journal-entry');
    const init = getInit(restCall);
    expect(init.method).toBe('POST');
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody.posting_date).toBe('2026-04-26');
    expect(parsedBody.lines).toHaveLength(2);
    expect(getHeaderValue(init, 'Content-Type')).toBe('application/json');
    expect(getHeaderValue(init, 'Idempotency-Key')).toBeUndefined();
  });

  it('forwards idempotency_key as the Idempotency-Key header', async () => {
    const fetchMock = makeFetch([buildResponse({ id: 'je-2' })]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    await client.postJournalEntry(
      {
        posting_date: '2026-04-26',
        lines: [{ account_no: '4100', amount: 10, debit_credit: 'credit' }],
      },
      { idempotencyKey: 'idemp-abc-123' },
    );

    const init = getInit(fetchMock.mock.calls[1]);
    expect(getHeaderValue(init, 'Idempotency-Key')).toBe('idemp-abc-123');
  });
});

describe('IntacctClient.recordAdjustment', () => {
  it('POSTs to accounts-receivable/adjustment with the full payload', async () => {
    const fetchMock = makeFetch([buildResponse({ id: 'adj-1' })]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    await client.recordAdjustment({
      charge_line_id: 'chg-1',
      adjustment_date: '2026-04-26',
      adjustment_type: 'WRITE_OFF',
      adjustment_reason_code: 'CO-45',
      amount: -50,
      memo: 'small balance',
    });

    const restCall = fetchMock.mock.calls[1];
    expect(String(restCall[0])).toContain('/objects/accounts-receivable/adjustment');
    const parsedBody = JSON.parse(getInit(restCall).body as string);
    expect(parsedBody.charge_line_id).toBe('chg-1');
    expect(parsedBody.adjustment_type).toBe('WRITE_OFF');
    expect(parsedBody.amount).toBe(-50);
  });
});

describe('IntacctClient.applyPayment', () => {
  it('POSTs to accounts-receivable/payment with applications array', async () => {
    const fetchMock = makeFetch([buildResponse({ id: 'pmt-1' })]);
    const client = new IntacctClient(creds, { fetch: fetchMock });

    await client.applyPayment(
      {
        payer_id: 'cust-1',
        payment_date: '2026-04-26',
        payment_method: 'ach',
        account_id: 'acct-cash',
        amount: 1000,
        applications: [
          { invoice_id: 'inv-1', amount: 600 },
          { invoice_id: 'inv-2', amount: 400 },
        ],
      },
      { idempotencyKey: 'pay-key' },
    );

    const restCall = fetchMock.mock.calls[1];
    expect(String(restCall[0])).toContain('/objects/accounts-receivable/payment');
    const parsedBody = JSON.parse(getInit(restCall).body as string);
    expect(parsedBody.applications).toHaveLength(2);
    expect(parsedBody.applications[0].invoice_id).toBe('inv-1');
    expect(getHeaderValue(getInit(restCall), 'Idempotency-Key')).toBe('pay-key');
  });
});
