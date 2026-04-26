"""
Credential bundle and Databricks secret-scope loader.

A single Sender ID is shared across all tenants the app/SDK serves.
Per-tenant credentials map a Sage Intacct company to a Web Services user
provisioned within that company.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class IntacctCredentials:
    """Credential bundle for one (Sage) tenant.

    Sender fields are the ISV identity (shared across all tenants).
    Company/user fields are per-tenant — one Web Services user per Sage company.
    """

    sender_id: str
    sender_password: str
    company_id: str
    ws_user_id: str
    ws_user_password: str

    @classmethod
    def from_databricks_secrets(
        cls,
        scope: str,
        company_id: str,
        *,
        sender_id_key: str = "intacct_sender_id",
        sender_password_key: str = "intacct_sender_password",
        user_key_template: str = "intacct_user_{company_id}",
        password_key_template: str = "intacct_password_{company_id}",
    ) -> IntacctCredentials:
        """Load credentials from a Databricks secret scope.

        Requires the optional ``databricks-sdk`` extra:
            pip install 'intacct_sdk[databricks]'
        """
        try:
            from databricks.sdk import WorkspaceClient
        except ImportError as e:  # pragma: no cover
            raise ImportError(
                "databricks-sdk is required for from_databricks_secrets(). "
                "Install via: pip install 'intacct_sdk[databricks]'"
            ) from e

        w = WorkspaceClient()

        def _get(key: str) -> str:
            import base64

            secret = w.secrets.get_secret(scope=scope, key=key)
            value = secret.value
            if value is None:
                raise ValueError(f"Secret '{key}' in scope '{scope}' has no value")
            return base64.b64decode(value).decode("utf-8")

        return cls(
            sender_id=_get(sender_id_key),
            sender_password=_get(sender_password_key),
            company_id=company_id,
            ws_user_id=_get(user_key_template.format(company_id=company_id)),
            ws_user_password=_get(password_key_template.format(company_id=company_id)),
        )
