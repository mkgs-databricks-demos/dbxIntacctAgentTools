# Generated Intacct REST client

This directory holds the OpenAPI-generated client for the Sage Intacct REST API. It is **regenerated**, not hand-written. Do not edit files under `intacct_openapi/` directly.

## Regenerate

```bash
# from the SDK root
./scripts/regenerate_client.sh
```

The script:
1. Downloads the latest OpenAPI spec from `developer.sage.com/intacct/apis/intacct/1/intacct-openapi`
2. Pins it to `spec/intacct-openapi-<version>.yaml`
3. Runs `openapi-python-client generate` into `_generated/intacct_openapi/`

## Why a wrapper?

The generated client is fine for typed primitives, but it doesn't know about:
- Token caching / refresh (handled by `IntacctAuth`)
- Pagination loops (handled by `pagination.paginate`)
- 429 / 5xx backoff (handled by `backoff.with_backoff`)
- Per-tenant credential routing
- Raw-response capture to UC Volumes

The high-level `IntacctClient` in `client.py` composes those concerns on top of the generated primitives.
