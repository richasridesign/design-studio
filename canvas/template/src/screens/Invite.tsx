import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { navigate } from '../lib/router';

export function Invite() {
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">Invite people</h1>
        <p className="text-sm text-fg-muted">They get an email with a link to join</p>
      </div>
      <Card className="flex flex-col gap-4 p-6">
        <Input label="Email addresses" placeholder="name@acme.test, another@acme.test" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate('/')}>Cancel</Button>
          <Button onClick={() => navigate('/')}>Send invites</Button>
        </div>
      </Card>
    </main>
  );
}
