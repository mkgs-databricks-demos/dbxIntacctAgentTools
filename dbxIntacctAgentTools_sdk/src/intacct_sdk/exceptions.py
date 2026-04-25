"""Typed exception hierarchy for the Intacct SDK."""

from __future__ import annotations


class IntacctError(Exception):
    """Base for all SDK errors."""

    def __init__(self, message: str, *, status_code: int | None = None, payload: object = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class AuthError(IntacctError):
    """Authentication / token-exchange failure."""


class RateLimitError(IntacctError):
    """429 / concurrency-limit hit. Caller should back off."""


class NotFoundError(IntacctError):
    """404 — resource does not exist for this tenant."""


class ServerError(IntacctError):
    """5xx — Sage Intacct returned a server-side error."""
