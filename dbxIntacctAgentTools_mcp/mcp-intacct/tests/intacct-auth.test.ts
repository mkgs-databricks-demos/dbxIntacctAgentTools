/**
 * Vitest suite for IntacctAuth — mirrors intacct_sdk/tests/test_auth.py.
 *
 * The auth class accepts an injected fetch + now() for determinism.
 */

import { describe, it, expect, vi } from 'vitest';
import { IntacctAuth } from '../server/intacct/auth.js';
import { AuthError } from '../server/intacct/errors.js';
import type { IntacctCredentials } from '../server/intacct/credentials.js';

const creds: IntacctCredentials = {
  senderId: 'SENDER',
  senderPassword: 'senderpw',
  companyId: 'acmecorp',
  wsUserId: 'ws_user',
  wsUserPassword: 'ws_pw',
};

const AUTH_URL = 'https://example.test/oauth2/token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('IntacctAuth', () => {
  it('caches the token within its TTL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'abc', expires_in: 3600 }));

    const auth = new IntacctAuth(creds, { authUrl: AUTH_URL, fetch: fetchMock });

    expect(await auth.getToken()).toBe('abc');
    expect(await auth.getToken()).toBe('abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the token has expired', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'first', expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'second', expires_in: 3600 }));

    let now = 1_000_000;
    const auth = new IntacctAuth(creds, { authUrl: AUTH_URL, fetch: fetchMock, now: () => now });

    expect(await auth.getToken()).toBe('first');
    // Advance past 60s (less the 30s safety margin, so 31s+ should trip a refresh)
    now += 35_000;
    expect(await auth.getToken()).toBe('second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('raises AuthError when the exchange fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 401));

    const auth = new IntacctAuth(creds, { authUrl: AUTH_URL, fetch: fetchMock });

    await expect(auth.getToken()).rejects.toBeInstanceOf(AuthError);
    await expect(auth.getToken()).rejects.toMatchObject({ statusCode: 401 });
  });

  it('invalidate() forces the next request to refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'first', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'second', expires_in: 3600 }));

    const auth = new IntacctAuth(creds, { authUrl: AUTH_URL, fetch: fetchMock });

    expect(await auth.getToken()).toBe('first');
    auth.invalidate();
    expect(await auth.getToken()).toBe('second');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent refreshes onto a single fetch (single-flight)', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(jsonResponse({ access_token: 'shared', expires_in: 3600 })), 5),
        ),
    );

    const auth = new IntacctAuth(creds, { authUrl: AUTH_URL, fetch: fetchMock });

    const [a, b, c] = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
    expect(a).toBe('shared');
    expect(b).toBe('shared');
    expect(c).toBe('shared');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
