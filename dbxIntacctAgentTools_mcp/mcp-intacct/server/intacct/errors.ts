/**
 * Typed exception hierarchy for the TypeScript Sage Intacct client.
 * Mirrors intacct_sdk/exceptions.py.
 */

export class IntacctError extends Error {
  readonly statusCode?: number;
  readonly payload?: unknown;

  constructor(message: string, opts: { statusCode?: number; payload?: unknown } = {}) {
    super(message);
    this.name = 'IntacctError';
    this.statusCode = opts.statusCode;
    this.payload = opts.payload;
  }
}

export class AuthError extends IntacctError {
  constructor(message: string, opts: { statusCode?: number; payload?: unknown } = {}) {
    super(message, opts);
    this.name = 'AuthError';
  }
}

export class RateLimitError extends IntacctError {
  constructor(message: string, opts: { statusCode?: number; payload?: unknown } = {}) {
    super(message, opts);
    this.name = 'RateLimitError';
  }
}

export class NotFoundError extends IntacctError {
  constructor(message: string, opts: { statusCode?: number; payload?: unknown } = {}) {
    super(message, opts);
    this.name = 'NotFoundError';
  }
}

export class ServerError extends IntacctError {
  constructor(message: string, opts: { statusCode?: number; payload?: unknown } = {}) {
    super(message, opts);
    this.name = 'ServerError';
  }
}
