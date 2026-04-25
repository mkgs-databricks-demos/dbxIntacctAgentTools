"""
Intacct SDK — typed Python client for the Sage Intacct REST API.

Public exports:
  - IntacctAuth      requests.auth.AuthBase subclass with token caching/refresh
  - IntacctCredentials   credential bundle (sender + per-tenant company/user)
  - IntacctClient    high-level client with pagination, backoff, raw-response capture
  - IntacctError, AuthError, RateLimitError, NotFoundError   typed exceptions
"""

from intacct_sdk.auth import IntacctAuth
from intacct_sdk.client import IntacctClient
from intacct_sdk.credentials import IntacctCredentials
from intacct_sdk.exceptions import (
    AuthError,
    IntacctError,
    NotFoundError,
    RateLimitError,
)

__all__ = [
    "AuthError",
    "IntacctAuth",
    "IntacctClient",
    "IntacctCredentials",
    "IntacctError",
    "NotFoundError",
    "RateLimitError",
]

__version__ = "0.1.0"
