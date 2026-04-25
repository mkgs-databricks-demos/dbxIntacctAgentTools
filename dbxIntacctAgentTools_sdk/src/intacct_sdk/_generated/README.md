# Generated Intacct REST client (Python)

This directory is the destination for the OpenAPI-generated Python client for the Sage Intacct REST API. The generated client is regenerated, not hand-written. Do not edit files under `intacct_openapi/` directly.

## Current status

**The auto-regen script does not work end-to-end at the moment.** Sage's developer portal (`developer.sage.com`) is fronted by Cloudflare and returns HTTP 403 to every automated request — the regen script's `curl` was blocked, as were variants with custom User-Agent headers.

What's already in place:
- `dbxIntacctAgentTools_sdk/scripts/regenerate_client.sh` — the regen script. Has a `--spec <path>` flag for use with a manually-downloaded local copy.
- `openapi-python-client>=0.21` — listed under the `dev` extras in `pyproject.toml`.
- `_generated/` directory + `.gitignore` rule that ignores `intacct_openapi/` (so generated files are never committed) but preserves this README and the `.gitkeep`.

What's missing:
- The actual generated client. As a result, the high-level `IntacctClient` in `client.py` works against `dict[str, Any]` payloads — it runs, but you don't get static checking on field names.

## Two paths to a typed Python client

Pick whichever fits your moment.

---

### Option A — Hand-craft Pydantic models

Best when you want to make progress without depending on Sage's portal availability. Tightest scope: just the fields the curated client methods actually return.

**Step 1: Create `src/intacct_sdk/models.py`** with Pydantic v2 models for each return shape:

```python
"""Hand-crafted Sage Intacct response models — minimal subset for the curated client surface."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class GLAccount(BaseModel):
    model_config = {"extra": "allow"}  # be tolerant of new Sage fields

    id: str
    account_no: str
    account_label: str
    category: str | None = None
    status: Literal["active", "inactive"] | None = None
    modified_at: str | None = None


class JournalEntryLine(BaseModel):
    model_config = {"extra": "allow"}

    id: str
    account_no: str
    amount: float
    debit_credit: Literal["debit", "credit"]
    memo: str | None = None
    dimensions: dict[str, str] = Field(default_factory=dict)


class JournalEntry(BaseModel):
    model_config = {"extra": "allow"}

    id: str
    batch_no: str | None = None
    posting_date: str
    description: str | None = None
    lines: list[JournalEntryLine] = Field(default_factory=list)


class GLDetailLine(BaseModel):
    model_config = {"extra": "allow"}

    id: str
    account_no: str
    posting_date: str
    amount: float
    source_doc: str | None = None
    description: str | None = None
    dimensions: dict[str, str] = Field(default_factory=dict)


class Customer(BaseModel):
    model_config = {"extra": "allow"}

    id: str
    customer_no: str | None = None
    name: str
    status: Literal["active", "inactive"] | None = None


class Invoice(BaseModel):
    model_config = {"extra": "allow"}

    id: str
    invoice_no: str
    customer_id: str
    state: Literal["open", "partially_paid", "paid", "voided"]
    posting_date: str
    due_date: str
    total_amount: float
    amount_due: float
    aging_bucket: Literal["current", "1_30", "31_60", "61_90", "90_plus"] | None = None


class CustomerBalance(BaseModel):
    model_config = {"extra": "allow"}

    customer_id: str
    total_open: float
    buckets: dict[Literal["current", "1_30", "31_60", "61_90", "90_plus"], float] = Field(
        default_factory=dict
    )
```

**Step 2: Update `client.py` method signatures** to return typed values via `model_validate`:

```python
from intacct_sdk.models import GLAccount, JournalEntry, Customer  # etc.


def list_gl_accounts(self, **filters: Any) -> Iterator[GLAccount]:
    for raw in self.list("objects/general-ledger/account", params=filters):
        yield GLAccount.model_validate(raw)


def get_journal_entry(self, journal_entry_id: str) -> JournalEntry:
    raw = self.request("GET", f"objects/general-ledger/journal-entry/{journal_entry_id}")
    return JournalEntry.model_validate(raw)
```

`extra="allow"` keeps the models forward-compatible: if Sage adds a field, the model stays valid and the new field is accessible via `model.model_extra`.

**Step 3: Add tests.** Extend `tests/test_client.py` (create if missing) with parsing tests:

```python
def test_list_gl_accounts_yields_typed_models():
    raw = {"id": "1", "account_no": "4100", "account_label": "Revenue"}
    parsed = GLAccount.model_validate(raw)
    assert parsed.account_no == "4100"
```

**Step 4: Verify.**

```bash
cd dbxIntacctAgentTools_sdk
pip install -e '.[dev]'
pytest
mypy src/intacct_sdk
ruff check src/intacct_sdk
```

**Step 5: Update `NEXT_STEPS.md` §1.1** to mark this approach as done; auto-gen (Option B) becomes the follow-up.

---

### Option B — Manual spec download + auto-regen

Best when you want full surface coverage and are OK doing one manual download per release.

**Step 1: Download the spec from a browser.**

1. In a normal browser session, navigate to:
   - https://developer.sage.com/intacct/apis/intacct/1/intacct-openapi
2. Find the "Download" / "Export" / "Raw" controls. The YAML lives at `https://developer.sage.com/intacct/apis/intacct/1/intacct-openapi.yaml`. JSON is also fine.
3. Save the file locally.

**Step 2: Place the spec in the repo.**

```bash
# from the repo root
mkdir -p dbxIntacctAgentTools_sdk/spec
mv ~/Downloads/intacct-openapi.yaml \
   dbxIntacctAgentTools_sdk/spec/intacct-openapi-$(date +%Y%m%d).yaml
```

The directory `dbxIntacctAgentTools_sdk/spec/` is **not** in the project `.gitignore` yet — add it before committing if you choose this path:

```bash
cat >> .gitignore <<'EOF'

# Sage spec downloads (Python SDK side)
dbxIntacctAgentTools_sdk/spec/
EOF
```

**Step 3: Generate the Python client.**

```bash
cd dbxIntacctAgentTools_sdk
pip install -e '.[dev]'
./scripts/regenerate_client.sh --spec spec/intacct-openapi-$(date +%Y%m%d).yaml
```

The script writes a full `openapi-python-client` package under `src/intacct_sdk/_generated/intacct_openapi/` with models, paths, and HTTP plumbing. Expect a few hundred files.

**Step 4: Use the generated models in `client.py`.**

```python
from intacct_sdk._generated.intacct_openapi.models import GLAccount  # actual path varies
```

The exact module paths depend on what `openapi-python-client` produces — open `src/intacct_sdk/_generated/intacct_openapi/` after generation and look at `models/__init__.py` for the export surface.

**Step 5: Verify.**

```bash
pytest
mypy src/intacct_sdk
```

**Step 6: Update `NEXT_STEPS.md` §1.1** to "done" and note the spec date.

**Step 7 (consideration):** decide whether to commit `_generated/intacct_openapi/` to the repo. Pros: CI works without a local spec. Cons: noisy diffs on every regen. Convention here is **don't commit** (the `.gitignore` rule already excludes it); use a CI artifact or a manual regen step.

---

## Why a thin wrapper around the generated client?

The generated client is fine for typed primitives, but it doesn't know about:
- Token caching / refresh (handled by `IntacctAuth`)
- Pagination loops (handled by `pagination.paginate`)
- 429 / 5xx backoff (handled by `backoff.with_backoff`)
- Per-tenant credential routing
- Raw-response capture to UC Volumes

The high-level `IntacctClient` in `client.py` composes those concerns on top of the generated primitives.

## See also

- [TypeScript equivalent](../../../../dbxIntacctAgentTools_mcp/mcp-intacct/server/intacct/_generated/README.md) — same regen story for the MCP server's TS client.
- [`NEXT_STEPS.md` §1.1](../../../../NEXT_STEPS.md) — current status of typed signatures across both SDKs.
