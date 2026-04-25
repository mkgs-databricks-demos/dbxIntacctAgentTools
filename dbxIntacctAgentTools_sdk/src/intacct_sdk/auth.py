"""
Sage Intacct REST API authentication.

Modeled on the epic_on_fhir EpicApiAuth pattern: a requests.auth.AuthBase
subclass that caches the bearer token and refreshes it lazily on every call.

Sage Intacct's REST API uses bearer tokens issued in exchange for a five-piece
credential bundle (sender + company + user). Tokens rotate on a schedule;
this class checks the cached expiry on every request and re-authenticates
when stale.

The token-exchange endpoint and request body shape are based on the REST API
documented at https://developer.sage.com/intacct/. If a future release of
the REST spec changes the auth surface, only ``generate_token()`` needs to
be updated — the AuthBase contract (header injection on each request) stays
the same.
"""

from __future__ import annotations

import datetime
import json
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

import requests

from intacct_sdk.credentials import IntacctCredentials
from intacct_sdk.exceptions import AuthError

_DEFAULT_AUTH_URL = "https://api.intacct.com/ia/api/v1-beta2/oauth2/token"
_DEFAULT_TOKEN_TTL = datetime.timedelta(minutes=55)  # Tokens are 1h; rotate at 55m


class IntacctAuth(requests.auth.AuthBase):
    """Bearer-token auth for Sage Intacct REST.

    Usage::

        creds = IntacctCredentials.from_databricks_secrets(
            scope="intacct_credentials",
            company_id="acmecorp",
        )
        auth = IntacctAuth(creds)
        resp = requests.get(
            "https://api.intacct.com/ia/api/v1/objects/general-ledger/account",
            auth=auth,
        )
    """

    def __init__(
        self,
        credentials: IntacctCredentials,
        *,
        auth_url: str = _DEFAULT_AUTH_URL,
        token_ttl: datetime.timedelta = _DEFAULT_TOKEN_TTL,
    ) -> None:
        self._credentials = credentials
        self._auth_url = auth_url
        self._token_ttl = token_ttl
        self._token: str | None = None
        self._token_expiry: datetime.datetime | None = None
        self._lock = Lock()

    # ------------------------------------------------------------------
    # AuthBase contract
    # ------------------------------------------------------------------
    def __call__(self, r: requests.PreparedRequest) -> requests.PreparedRequest:
        r.headers["Authorization"] = f"Bearer {self.get_token()}"
        r.headers["Accept"] = "application/json"
        if r.body is not None and "Content-Type" not in r.headers:
            r.headers["Content-Type"] = "application/json"
        return r

    # ------------------------------------------------------------------
    # Token cache
    # ------------------------------------------------------------------
    def get_token(self, *, now: datetime.datetime | None = None, timeout: float = 30) -> str:
        """Return a non-expired bearer token, refreshing if necessary."""
        now = now if now is not None else datetime.datetime.now(ZoneInfo("UTC"))
        with self._lock:
            if self._token is None or self._token_expiry is None or now >= self._token_expiry:
                payload = self._exchange(timeout=timeout)
                self._token = payload["access_token"]
                expires_in = int(payload.get("expires_in", int(self._token_ttl.total_seconds())))
                self._token_expiry = now + datetime.timedelta(seconds=expires_in) - datetime.timedelta(seconds=30)
            return self._token

    def invalidate(self) -> None:
        """Force a refresh on the next request (e.g. after a 401)."""
        with self._lock:
            self._token = None
            self._token_expiry = None

    # ------------------------------------------------------------------
    # Token exchange
    # ------------------------------------------------------------------
    def _exchange(self, *, timeout: float) -> dict[str, Any]:
        """Exchange Sender + Company + User credentials for a bearer token."""
        body = {
            "grant_type": "password",
            "sender_id": self._credentials.sender_id,
            "sender_password": self._credentials.sender_password,
            "company_id": self._credentials.company_id,
            "user_id": self._credentials.ws_user_id,
            "user_password": self._credentials.ws_user_password,
        }
        resp = requests.post(
            self._auth_url,
            data=body,
            headers={"Accept": "application/json"},
            timeout=timeout,
        )
        if resp.status_code != 200:
            raise AuthError(
                f"Intacct token exchange failed: HTTP {resp.status_code}",
                status_code=resp.status_code,
                payload=_safe_json(resp),
            )
        try:
            return resp.json()
        except ValueError as e:
            raise AuthError("Intacct token exchange returned non-JSON body") from e

    # ------------------------------------------------------------------
    # Probes
    # ------------------------------------------------------------------
    def can_connect(self, *, timeout: float = 30) -> bool:
        """Best-effort probe — returns True if a token can be issued."""
        try:
            self._exchange(timeout=timeout)
            return True
        except AuthError:
            return False


def _safe_json(resp: requests.Response) -> object:
    try:
        return resp.json()
    except ValueError:
        return resp.text[:500]
