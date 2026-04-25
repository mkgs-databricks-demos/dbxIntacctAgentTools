/**
 * Sage Intacct credential bundle and Databricks secret-scope loader.
 *
 * Sender credentials are the ISV identity (shared across tenants) and are
 * injected via app.yaml `valueFrom` directives — read from process.env.
 *
 * Per-tenant company/user credentials are NOT pre-injected (one user per
 * Sage company, resolved at request time based on the MCP `tenant_id`
 * argument). The `loadTenant()` helper resolves them via the Databricks
 * SDK using the app's auto-provisioned SPN identity.
 */

import { WorkspaceClient } from '@databricks/sdk-experimental';

export interface IntacctCredentials {
  senderId: string;
  senderPassword: string;
  companyId: string;
  wsUserId: string;
  wsUserPassword: string;
}

const SECRET_SCOPE_ENV = 'INTACCT_SECRET_SCOPE';
const DEFAULT_SECRET_SCOPE = 'intacct_credentials';

/**
 * Resolve the Sage credentials for one tenant.
 *
 * Reads:
 *   - INTACCT_SENDER_ID, INTACCT_SENDER_PASSWORD from process.env
 *     (injected via app.yaml valueFrom)
 *   - intacct_user_<companyId>, intacct_password_<companyId> from the
 *     Databricks secret scope (resolved at request time)
 */
export async function loadTenant(companyId: string): Promise<IntacctCredentials> {
  const senderId = requireEnv('INTACCT_SENDER_ID');
  const senderPassword = requireEnv('INTACCT_SENDER_PASSWORD');

  const scope = process.env[SECRET_SCOPE_ENV] ?? DEFAULT_SECRET_SCOPE;
  // Empty config object → SDK reads DATABRICKS_HOST + auth from env
  // (the app platform injects these for the auto-provisioned SPN).
  const w = new WorkspaceClient({});

  const userKey = `intacct_user_${companyId}`;
  const passwordKey = `intacct_password_${companyId}`;

  const [wsUserId, wsUserPassword] = await Promise.all([
    readSecret(w, scope, userKey),
    readSecret(w, scope, passwordKey),
  ]);

  return {
    senderId,
    senderPassword,
    companyId,
    wsUserId,
    wsUserPassword,
  };
}

async function readSecret(w: WorkspaceClient, scope: string, key: string): Promise<string> {
  const resp = await w.secrets.getSecret({ scope, key });
  // Databricks SDK returns base64-encoded string in resp.value
  if (!resp.value) {
    throw new Error(`Secret '${key}' in scope '${scope}' has no value`);
  }
  return Buffer.from(resp.value, 'base64').toString('utf-8');
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}
