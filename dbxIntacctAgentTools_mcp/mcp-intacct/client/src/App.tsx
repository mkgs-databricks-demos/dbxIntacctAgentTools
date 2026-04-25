import { useState } from 'react';
import { createBrowserRouter, RouterProvider, NavLink, Outlet } from 'react-router';
import { Button } from '@databricks/appkit-ui/react';
import { TenantList } from './components/TenantList';
import { TenantForm } from './components/TenantForm';
import { RecentCalls } from './components/RecentCalls';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

function Layout() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-6 py-3 flex items-center gap-4">
        <h1 className="text-lg font-semibold text-foreground">mcp-intacct admin</h1>
        <nav className="flex gap-1">
          <NavLink to="/" end className={navLinkClass}>
            Tenants
          </NavLink>
          <NavLink to="/calls" className={navLinkClass}>
            Recent calls
          </NavLink>
        </nav>
      </header>

      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TenantsPage /> },
      { path: '/calls', element: <CallsPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; tenantId: string };

function TenantsPage() {
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Tenants</h2>
          <p className="text-sm text-muted-foreground">
            Sage Intacct companies served by this MCP server.
          </p>
        </div>
        {form.mode === 'closed' && (
          <Button onClick={() => setForm({ mode: 'create' })}>+ Add tenant</Button>
        )}
      </div>

      {form.mode !== 'closed' && (
        <TenantForm
          tenantId={form.mode === 'edit' ? form.tenantId : undefined}
          onDone={() => setForm({ mode: 'closed' })}
        />
      )}

      <TenantList onEdit={(tenantId) => setForm({ mode: 'edit', tenantId })} />
    </div>
  );
}

function CallsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Recent MCP calls</h2>
        <p className="text-sm text-muted-foreground">
          Last 25 tool invocations across all tenants.
        </p>
      </div>
      <RecentCalls />
    </div>
  );
}
