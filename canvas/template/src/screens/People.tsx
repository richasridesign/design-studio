import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { navigate } from '../lib/router';
import { useScenario } from '../scenarios';

export function People() {
  const s = useScenario();
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">People</h1>
          <p className="text-sm text-fg-muted">Who can use this workspace, and what they can do</p>
        </div>
        {s.canInvite && <Button onClick={() => navigate('/invite')}>Invite people</Button>}
      </div>
      <Input placeholder="Search name or email" />
      <Card>
        {s.loading && <p className="p-6 text-sm text-fg-muted">Loading people…</p>}
        {s.error && (
          <div className="flex items-center justify-between gap-4 p-6">
            <p className="text-sm text-red-700">{s.error}</p>
            <Button variant="secondary" size="sm">Try again</Button>
          </div>
        )}
        {!s.loading && !s.error && s.people.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <h2 className="font-medium">No one here yet</h2>
            <p className="text-sm text-fg-muted">Invite your team to start working together.</p>
          </div>
        )}
        {s.people.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-fg-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {s.people.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-fg-muted">{p.email}</div>
                  </td>
                  <td className="px-4 py-3">{p.role}</td>
                  <td className="px-4 py-3"><Badge tone={p.status === 'Active' ? 'success' : 'neutral'}>{p.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}
