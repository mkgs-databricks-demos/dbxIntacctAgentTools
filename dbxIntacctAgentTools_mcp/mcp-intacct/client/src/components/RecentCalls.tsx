import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { trpc } from '../lib/trpc';

const PAGE_SIZE = 25;
const ALL = 'all';

interface Filters {
  tenantId: string;
  toolName: string;
  status: 'all' | 'success' | 'error';
}

const EMPTY_FILTERS: Filters = { tenantId: '', toolName: ALL, status: 'all' };

export function RecentCalls() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);

  const toolNames = trpc.mcpCallLog.toolNames.useQuery();
  const calls = trpc.mcpCallLog.recent.useQuery({
    tenantId: filters.tenantId || undefined,
    toolName: filters.toolName === ALL ? undefined : filters.toolName,
    status: filters.status === 'all' ? undefined : filters.status,
    limit: PAGE_SIZE,
    offset,
  });

  const total = calls.data?.total ?? 0;
  const rows = calls.data?.rows ?? [];
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + rows.length, total);
  const hasNext = offset + rows.length < total;
  const hasPrev = offset > 0;

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setOffset(0); // any filter change resets to first page
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent MCP calls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3" data-testid="recent-calls-filters">
          <div className="flex-1 min-w-[180px] space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="filter-tenant">
              Tenant ID
            </label>
            <Input
              id="filter-tenant"
              placeholder="any"
              value={filters.tenantId}
              onChange={(e) => updateFilter('tenantId', e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[180px] space-y-1">
            <label className="text-xs text-muted-foreground">Tool</label>
            <Select value={filters.toolName} onValueChange={(v) => updateFilter('toolName', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All tools</SelectItem>
                {(toolNames.data ?? []).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[120px] space-y-1">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select
              value={filters.status}
              onValueChange={(v) => updateFilter('status', v as Filters['status'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setOffset(0);
            }}
            disabled={
              filters.tenantId === '' && filters.toolName === ALL && filters.status === 'all'
            }
          >
            Clear
          </Button>
        </div>

        {calls.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : calls.error ? (
          <p className="text-sm text-destructive">Failed to load: {calls.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching MCP calls.</p>
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
              {rows.map((c) => (
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

        <div
          className="flex items-center justify-between text-xs text-muted-foreground"
          data-testid="recent-calls-pagination"
        >
          <span>
            {total === 0 ? 'No results' : `${pageStart}–${pageEnd} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              disabled={!hasPrev}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              disabled={!hasNext}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
