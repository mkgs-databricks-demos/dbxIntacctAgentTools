/**
 * Sage Intacct credential bundle and Databricks secret-scope loader.
 *
 * Sender credentials are the ISV identity (shared across tenants) and
 * are injected via app.yaml `valueFrom` directives — read from
 * process.env.
 *
 * Per-tenant company/user credentials are NOT pre-injected. The
 * `loadTenant()` helper:
 *   1. Validates the tenant_id against the Lakebase tenant_registry
 *      (throws if missing or disabled).
 *   2. Resolves the actual secret keys (user/password) from the
 *      registry record — this lets ops rotate or rename keys without
 *      a code deploy.
 *   3. Reads the user/password from the Databricks secret scope using
 *      the app's auto-provisioned SPN identity.
 */

import { WorkspaceClient } from '@databricks/sdk-experimental';
import { getLakebase } from '../lakebase/index.js';

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
 *   - tenant record from Lakebase tenant_registry (throws if absent)
 *   - user/password secrets from the Databricks secret scope, using
 *     the keys named in the registry record
 */
export async function loadTenant(tenantId: string): Promise<IntacctCredentials> {
  const senderId = requireEnv('INTACCT_SENDER_ID');
  const senderPassword = requireEnv('INTACCT_SENDER_PASSWORD');

  const { registry } = getLakebase();
  const tenant = await registry.require(tenantId);

  const scope = process.env[SECRET_SCOPE_ENV] ?? DEFAULT_SECRET_SCOPE;
  // Empty config object → SDK reads DATABRICKS_HOST + auth from env
  // (the app platform injects these for the auto-provisioned SPN).
  const w = new WorkspaceClient({});

  const [wsUserId, wsUserPassword] = await Promise.all([
    readSecret(w, scope, tenant.userSecretKey),
    readSecret(w, scope, tenant.passwordSecretKey),
  ]);

  return {
    senderId,
    senderPassword,
    companyId: tenant.companyId,
    wsUserId,
    wsUserPassword,
  };
}

async function readSecret(w: WorkspaceClient, scope: string, key: string): Promise<string> {
  const resp = await w.secrets.getSecret({ scope, key });
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
