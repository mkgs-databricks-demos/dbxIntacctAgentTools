import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { trpc } from '../lib/trpc';

export function RecentCalls() {
  const calls = trpc.mcpCallLog.recent.useQuery({ limit: 25 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent MCP calls</CardTitle>
      </CardHeader>
      <CardContent>
        {calls.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : calls.error ? (
          <p className="text-sm text-destructive">Failed to load: {calls.error.message}</p>
        ) : calls.data && calls.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No MCP calls yet.</p>
        ) : (
          <table className="w-full text-sm" data-testid="recent-calls-table">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">When</th>
                <th className="py-2">Tool</th>
                <th className="py-2">Tenant</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Latency</th>
              </tr>
            </thead>
            <tbody>
              {(calls.data ?? []).map((c) => (
                <tr key={c.callId} className="border-t">
                  <td className="py-2 text-muted-foreground">
                    {new Date(c.createdAt).toLocaleTimeString()}
                  </td>
                  <td className="py-2 font-medium">{c.toolName}</td>
                  <td className="py-2 text-muted-foreground">{c.tenantId ?? '—'}</td>
                  <td className="py-2">
                    <Badge variant={c.status === 'success' ? 'default' : 'destructive'}>
                      {c.status}
                    </Badge>
                  </td>
                  <td className="py-2 text-right tabular-nums">{c.latencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
