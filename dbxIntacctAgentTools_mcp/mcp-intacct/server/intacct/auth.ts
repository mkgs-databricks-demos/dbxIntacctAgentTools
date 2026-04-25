/**
 * Sage Intacct REST API authentication.
 *
 * Mirrors intacct_sdk/auth.py — token caching with lazy refresh.
 *
 * Sage Intacct issues bearer tokens in exchange for the five-piece
 * credential bundle (sender + company + user). Tokens rotate on a
 * schedule; this class checks the cached expiry on every call and
 * re-authenticates when the token is stale or absent.
 */

import { AuthError } from './errors.js';
import type { IntacctCredentials } from './credentials.js';

const DEFAULT_AUTH_URL = 'https://api.intacct.com/ia/api/v1-beta2/oauth2/token';
const DEFAULT_TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes (10% safety margin)

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

export interface IntacctAuthOptions {
  authUrl?: string;
  tokenTtlMs?: number;
  /** Override the global fetch (useful for testing). */
  fetch?: typeof globalThis.fetch;
  /** Wall-clock injection point for testing. */
  now?: () => number;
}

/**
 * Cached, auto-refreshing bearer-token authenticator for one tenant.
 *
 * Use ``authorize()`` to obtain headers ready for a Sage REST request.
 * ``invalidate()`` forces a refresh on the next call (e.g. after a 401).
 */
export class IntacctAuth {
  private readonly creds: IntacctCredentials;
  private readonly authUrl: string;
  private readonly tokenTtlMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly nowFn: () => number;

  private token: string | null = null;
  private tokenExpiryMs = 0;
  private inflight: Promise<string> | null = null;

  constructor(credentials: IntacctCredentials, opts: IntacctAuthOptions = {}) {
    this.creds = credentials;
    this.authUrl = opts.authUrl ?? DEFAULT_AUTH_URL;
    this.tokenTtlMs = opts.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.nowFn = opts.now ?? (() => Date.now());
  }

  /** Return a non-expired bearer token, refreshing if necessary. */
  async getToken(): Promise<string> {
    const now = this.nowFn();
    if (this.token && now < this.tokenExpiryMs) {
      return this.token;
    }
    // Single-flight: collapse concurrent refreshes onto one fetch
    if (!this.inflight) {
      this.inflight = this.exchange().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Force a refresh on the next request (e.g. after a 401). */
  invalidate(): void {
    this.token = null;
    this.tokenExpiryMs = 0;
  }

  /** Build authorization headers ready for a Sage REST call. */
  async authorize(extraHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...extraHeaders,
    };
  }

  /** Best-effort probe — true if a token can be issued. */
  async canConnect(): Promise<boolean> {
    try {
      await this.exchange();
      return true;
    } catch {
      return false;
    }
  }

  /** Exchange Sender + Company + User credentials for a bearer token. */
  private async exchange(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'password',
      sender_id: this.creds.senderId,
      sender_password: this.creds.senderPassword,
      company_id: this.creds.companyId,
      user_id: this.creds.wsUserId,
      user_password: this.creds.wsUserPassword,
    });

    const resp = await this.fetchImpl(this.authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!resp.ok) {
      const payload = await safeJson(resp);
      throw new AuthError(`Intacct token exchange failed: HTTP ${resp.status}`, {
        statusCode: resp.status,
        payload,
      });
    }

    const data = (await resp.json()) as TokenResponse;
    if (!data.access_token) {
      throw new AuthError('Intacct token response missing access_token');
    }

    const expiresInSec = data.expires_in ?? Math.floor(this.tokenTtlMs / 1000);
    // Subtract a 30-second safety margin
    const ttlMs = Math.max(0, expiresInSec * 1000 - 30_000);
    this.token = data.access_token;
    this.tokenExpiryMs = this.nowFn() + ttlMs;
    return data.access_token;
  }
}

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
