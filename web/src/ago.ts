// One way to say when something happened: "just now", "15 min ago", "3 h ago", "yesterday", "4 days ago", "12 Oct".

const MIN = 60_000;
const DAY = 86_400_000;

function daysBack(at: number, now: number) {
  const a = new Date(at);
  const b = new Date(now);
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / DAY);
}

export function ago(at: number, now = Date.now()): string {
  const ms = Math.max(0, now - at);
  if (ms < MIN) return 'just now';
  if (ms < 60 * MIN) return `${Math.floor(ms / MIN)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / (60 * MIN))} h ago`;
  const days = daysBack(at, now);
  if (days < 7) return days <= 1 ? 'yesterday' : `${days} days ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
