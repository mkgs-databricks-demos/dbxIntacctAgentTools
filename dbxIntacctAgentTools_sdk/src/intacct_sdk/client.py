"""
High-level Sage Intacct REST client.

Wraps the OpenAPI-generated client (under ``_generated/``) with:
  - Token-cached IntacctAuth
  - Per-tenant credential resolution
  - Pagination over readByQuery / list endpoints
  - Exponential backoff on 429 / 5xx
  - Optional raw-response capture (writes JSON to a Databricks UC volume)

The high-level client is opinionated — it does NOT expose every endpoint
1:1. Use ``client.session`` to drop down to the generated client when you
need a method this wrapper doesn't surface.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from intacct_sdk.auth import IntacctAuth
from intacct_sdk.credentials import IntacctCredentials
from intacct_sdk.exceptions import (
    AuthError,
    IntacctError,
    NotFoundError,
    RateLimitError,
    ServerError,
)
from intacct_sdk.pagination import paginate

_DEFAULT_BASE_URL = "https://api.intacct.com/ia/api/v1"


class IntacctClient:
    """High-level Sage Intacct REST client."""

    def __init__(
        self,
        credentials: IntacctCredentials,
        *,
        base_url: str = _DEFAULT_BASE_URL,
        raw_response_dir: Path | None = None,
        request_timeout: float = 60.0,
    ) -> None:
        self._auth = IntacctAuth(credentials)
        self._base_url = base_url.rstrip("/")
        self._raw_response_dir = raw_response_dir
        self._timeout = request_timeout
        self._tenant_id = credentials.company_id

        self.session = requests.Session()
        self.session.auth = self._auth

    # ------------------------------------------------------------------
    # Low-level
    # ------------------------------------------------------------------
    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
    ) -> dict[str, Any]:
        """Perform a single REST call. Handles error mapping + raw capture."""
        url = f"{self._base_url}/{path.lstrip('/')}"
        request_id = uuid.uuid4().hex

        resp = self.session.request(
            method=method.upper(),
            url=url,
            params=params,
            json=json_body,
            timeout=self._timeout,
            headers={"X-Intacct-Request-Id": request_id},
        )

        body = _safe_json(resp)
        if self._raw_response_dir is not None:
            _write_raw_response(
                self._raw_response_dir,
                tenant_id=self._tenant_id,
                request_id=request_id,
                method=method,
                path=path,
                http_status=resp.status_code,
                body=body,
            )

        if resp.status_code == 401:
            self._auth.invalidate()
            raise AuthError("401 Unauthorized — token invalidated, retry", status_code=401, payload=body)
        if resp.status_code == 404:
            raise NotFoundError(f"Not found: {method} {path}", status_code=404, payload=body)
        if resp.status_code == 429:
            raise RateLimitError("429 Too Many Requests", status_code=429, payload=body)
        if 500 <= resp.status_code < 600:
            raise ServerError(f"5xx from Intacct: {resp.status_code}", status_code=resp.status_code, payload=body)
        if not resp.ok:
            raise IntacctError(
                f"Unexpected {resp.status_code} from Intacct",
                status_code=resp.status_code,
                payload=body,
            )
        return body if isinstance(body, dict) else {"data": body}

    # ------------------------------------------------------------------
    # Paginated reads
    # ------------------------------------------------------------------
    def list(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        items_key: str = "ia::result",
        next_cursor_key: str = "next_cursor",
        max_pages: int | None = None,
    ) -> Iterator[dict[str, Any]]:
        """Iterate every record across paginated GET ``path`` calls."""
        params = dict(params or {})

        def _fetch(cursor: str | None) -> dict[str, Any]:
            local = dict(params)
            if cursor is not None:
                local["cursor"] = cursor
            return self.request("GET", path, params=local)

        yield from paginate(
            _fetch,
            items_key=items_key,
            next_cursor_key=next_cursor_key,
            max_pages=max_pages,
        )

    # ------------------------------------------------------------------
    # Curated convenience methods (extend as you build out the Tool surface)
    # ------------------------------------------------------------------
    def list_gl_accounts(self, **filters: Any) -> Iterator[dict[str, Any]]:
        return self.list("objects/general-ledger/account", params=filters)

    def list_journal_entries(self, **filters: Any) -> Iterator[dict[str, Any]]:
        return self.list("objects/general-ledger/journal-entry", params=filters)

    def list_customers(self, **filters: Any) -> Iterator[dict[str, Any]]:
        return self.list("objects/accounts-receivable/customer", params=filters)

    def list_vendors(self, **filters: Any) -> Iterator[dict[str, Any]]:
        return self.list("objects/accounts-payable/vendor", params=filters)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _safe_json(resp: requests.Response) -> Any:
    try:
        return resp.json()
    except ValueError:
        return resp.text


def _write_raw_response(
    root: Path,
    *,
    tenant_id: str,
    request_id: str,
    method: str,
    path: str,
    http_status: int,
    body: Any,
) -> None:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_dir = root / tenant_id / today
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{request_id}.json"
    payload = {
        "request_id": request_id,
        "tenant_id": tenant_id,
        "method": method,
        "path": path,
        "http_status": http_status,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "body": body,
    }
    out_path.write_text(json.dumps(payload, default=str))
