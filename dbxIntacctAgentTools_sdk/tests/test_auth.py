"""Tests for IntacctAuth."""

from __future__ import annotations

import datetime
from zoneinfo import ZoneInfo

import pytest
import responses

from intacct_sdk.auth import IntacctAuth
from intacct_sdk.credentials import IntacctCredentials
from intacct_sdk.exceptions import AuthError


@pytest.fixture
def creds() -> IntacctCredentials:
    return IntacctCredentials(
        sender_id="SENDER",
        sender_password="senderpw",
        company_id="acmecorp",
        ws_user_id="ws_user",
        ws_user_password="ws_pw",
    )


@responses.activate
def test_get_token_caches(creds: IntacctCredentials) -> None:
    auth_url = "https://example.test/oauth2/token"
    responses.post(
        auth_url,
        json={"access_token": "abc", "expires_in": 3600},
        status=200,
    )

    auth = IntacctAuth(creds, auth_url=auth_url)

    assert auth.get_token() == "abc"
    # Subsequent calls within TTL must NOT hit the auth endpoint again
    assert auth.get_token() == "abc"
    assert len(responses.calls) == 1


@responses.activate
def test_get_token_refreshes_when_expired(creds: IntacctCredentials) -> None:
    auth_url = "https://example.test/oauth2/token"
    responses.post(auth_url, json={"access_token": "first", "expires_in": 60}, status=200)
    responses.post(auth_url, json={"access_token": "second", "expires_in": 3600}, status=200)

    auth = IntacctAuth(creds, auth_url=auth_url)
    now = datetime.datetime.now(ZoneInfo("UTC"))

    assert auth.get_token(now=now) == "first"
    # Past the (60s - 30s safety = 30s) window
    assert auth.get_token(now=now + datetime.timedelta(seconds=120)) == "second"
    assert len(responses.calls) == 2


@responses.activate
def test_failed_exchange_raises(creds: IntacctCredentials) -> None:
    auth_url = "https://example.test/oauth2/token"
    responses.post(auth_url, json={"error": "invalid_grant"}, status=401)

    auth = IntacctAuth(creds, auth_url=auth_url)
    with pytest.raises(AuthError) as exc:
        auth.get_token()
    assert exc.value.status_code == 401


@responses.activate
def test_invalidate_forces_refresh(creds: IntacctCredentials) -> None:
    auth_url = "https://example.test/oauth2/token"
    responses.post(auth_url, json={"access_token": "first", "expires_in": 3600}, status=200)
    responses.post(auth_url, json={"access_token": "second", "expires_in": 3600}, status=200)

    auth = IntacctAuth(creds, auth_url=auth_url)
    assert auth.get_token() == "first"

    auth.invalidate()
    assert auth.get_token() == "second"
    assert len(responses.calls) == 2
