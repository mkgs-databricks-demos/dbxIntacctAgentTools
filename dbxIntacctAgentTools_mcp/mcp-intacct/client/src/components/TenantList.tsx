import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { trpc } from '../lib/trpc';

export function TenantList({
  onEdit,
  canEdit,
}: {
  onEdit: (tenantId: string) => void;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const tenants = trpc.tenants.list.useQuery();
  const disable = trpc.tenants.disable.useMutation({
    onSuccess: () => {
      void utils.tenants.list.invalidate();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tenants</CardTitle>
      </CardHeader>
      <CardContent>
        {tenants.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : tenants.error ? (
          <p className="text-sm text-destructive">Failed to load tenants: {tenants.error.message}</p>
        ) : tenants.data && tenants.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tenants registered yet.</p>
        ) : (
          <table className="w-full text-sm" data-testid="tenants-table">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">Tenant</th>
                <th className="py-2">Company</th>
                <th className="py-2">Status</th>
                <th className="py-2">Updated</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(tenants.data ?? []).map((t) => (
                <tr key={t.tenantId} className="border-t">
                  <td className="py-2 font-medium">{t.displayName}</td>
                  <td className="py-2 text-muted-foreground">{t.companyId}</td>
                  <td className="py-2">
                    <Badge variant={t.enabled ? 'default' : 'secondary'}>
                      {t.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {new Date(t.updatedAt).toLocaleString()}
                  </td>
                  <td className="py-2 text-right space-x-2">
                    {canEdit ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onEdit(t.tenantId)}>
                          Edit
                        </Button>
                        {t.enabled && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => disable.mutate({ tenantId: t.tenantId })}
                            disabled={disable.isPending}
                          >
                            Disable
                          </Button>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">read-only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
