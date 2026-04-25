"""Backoff helpers for transient Sage Intacct REST failures."""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

from intacct_sdk.exceptions import RateLimitError, ServerError

T = TypeVar("T")


def with_backoff(
    fn: Callable[..., T],
    *,
    max_attempts: int = 5,
    initial_seconds: float = 1.0,
    max_seconds: float = 30.0,
) -> Callable[..., T]:
    """Wrap a callable with exponential backoff + jitter.

    Retries on transient failures only:
      - RateLimitError (429)
      - ServerError (5xx)
    """
    return retry(
        retry=retry_if_exception_type((RateLimitError, ServerError)),
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential_jitter(initial=initial_seconds, max=max_seconds),
        reraise=True,
    )(fn)
