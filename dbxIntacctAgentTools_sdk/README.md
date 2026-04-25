# intacct_sdk

Typed Python SDK for the Sage Intacct REST API. Provides:

- `IntacctAuth` — `requests.auth.AuthBase` subclass with bearer-token caching, expiry tracking, and lazy refresh (modeled on `epic_on_fhir.EpicApiAuth`)
- `IntacctClient` — high-level wrapper with pagination, exponential backoff, raw-response capture, and per-tenant credential routing
- `IntacctCredentials` — credential bundle with a `from_databricks_secrets()` loader

The OpenAPI-generated low-level client lives under `src/intacct_sdk/_generated/` and is regenerated, not hand-edited.

## Install

```bash
pip install -e '.[dev,databricks]'
```

## Usage

### From a Lakeflow Job (Databricks-managed credentials)

```python
from pathlib import Path
from intacct_sdk import IntacctCredentials, IntacctClient

creds = IntacctCredentials.from_databricks_secrets(
    scope="intacct_credentials",
    company_id="acmecorp",  # the Sage company you're operating against
)

client = IntacctClient(
    creds,
    raw_response_dir=Path("/Volumes/hls_fde_dev/intacct/raw_responses"),
)

for account in client.list_gl_accounts(modified_date=">2026-01-01"):
    print(account["account_no"], account["account_label"])
```

### From a local notebook (env-var credentials)

```python
import os
from intacct_sdk import IntacctCredentials, IntacctClient

creds = IntacctCredentials(
    sender_id=os.environ["INTACCT_SENDER_ID"],
    sender_password=os.environ["INTACCT_SENDER_PASSWORD"],
    company_id="acmecorp",
    ws_user_id=os.environ["INTACCT_WS_USER"],
    ws_user_password=os.environ["INTACCT_WS_PASSWORD"],
)

client = IntacctClient(creds)
```

## Auth flow

The token-exchange endpoint and request body shape track the documented Sage Intacct REST API. `IntacctAuth` caches tokens for 55 minutes (10% safety margin under the 1-hour TTL), and re-authenticates on:
- expiry
- explicit `auth.invalidate()` calls
- 401 responses (the high-level client invalidates automatically)

## Regenerating the OpenAPI client

```bash
./scripts/regenerate_client.sh
```

## Testing

```bash
pytest
```

Network calls in tests are stubbed via `responses`. No real Sage Intacct sandbox is needed for the test suite.
