import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@databricks/appkit-ui/react';
import { trpc } from '../lib/trpc';

interface Props {
  /** Tenant id to edit; undefined for create */
  tenantId?: string;
  onDone: () => void;
}

interface FormState {
  tenantId: string;
  companyId: string;
  displayName: string;
  notes: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  tenantId: '',
  companyId: '',
  displayName: '',
  notes: '',
  enabled: true,
};

export function TenantForm({ tenantId, onDone }: Props) {
  const utils = trpc.useUtils();
  const existing = trpc.tenants.get.useQuery(
    { tenantId: tenantId ?? '' },
    { enabled: !!tenantId },
  );

  // Track which tenant_id this overlay was hydrated for so we don't
  // clobber unsaved edits when the parent refetches the list.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  if (tenantId && existing.data && hydratedFor !== tenantId) {
    setHydratedFor(tenantId);
    setForm({
      tenantId: existing.data.tenantId,
      companyId: existing.data.companyId,
      displayName: existing.data.displayName,
      notes: existing.data.notes ?? '',
      enabled: existing.data.enabled,
    });
  } else if (!tenantId && hydratedFor !== '') {
    setHydratedFor('');
    setForm(EMPTY_FORM);
  }

  const upsert = trpc.tenants.upsert.useMutation({
    onSuccess: () => {
      void utils.tenants.list.invalidate();
      onDone();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    upsert.mutate({
      tenantId: form.tenantId,
      companyId: form.companyId,
      displayName: form.displayName,
      notes: form.notes ? form.notes : null,
      enabled: form.enabled,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tenantId ? `Edit ${tenantId}` : 'Add tenant'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3" data-testid="tenant-form">
          <Field label="Tenant ID" htmlFor="tenantId">
            <Input
              id="tenantId"
              value={form.tenantId}
              onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))}
              disabled={!!tenantId}
              required
            />
          </Field>
          <Field label="Company ID (Sage Intacct)" htmlFor="companyId">
            <Input
              id="companyId"
              value={form.companyId}
              onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
              required
            />
          </Field>
          <Field label="Display name" htmlFor="displayName">
            <Input
              id="displayName"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              required
            />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Input
              id="notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            Enabled
          </label>

          {upsert.error && (
            <p className="text-sm text-destructive">{upsert.error.message}</p>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
