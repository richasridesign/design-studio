// Fake data per state. The canvas sets ?scenario=<id> on each frame; screens read it with useScenario().

export type Person = { id: string; name: string; email: string; role: 'Admin' | 'Editor' | 'Viewer'; status: 'Active' | 'Invited' };

export type Scenario = {
  id: string;
  name: string;
  people: Person[];
  loading?: boolean;
  error?: string;
  canInvite?: boolean;
};

const people: Person[] = [
  { id: '1', name: 'Alex Morgan', email: 'alex@acme.test', role: 'Admin', status: 'Active' },
  { id: '2', name: 'Sam Lee', email: 'sam@acme.test', role: 'Editor', status: 'Active' },
  { id: '3', name: 'Jo Park', email: 'jo@acme.test', role: 'Viewer', status: 'Invited' },
];

export const scenarios: Scenario[] = [
  { id: 'default', name: 'Signed in, set up', people, canInvite: true },
  { id: 'empty', name: 'New workspace', people: [], canInvite: true },
  { id: 'loading', name: 'Loading', people: [], loading: true, canInvite: true },
  { id: 'error', name: 'Server failing', people: [], error: 'Request failed: 500', canInvite: true },
  { id: 'no-access', name: 'No access: viewer', people, canInvite: false },
];

export function useScenario(): Scenario {
  const id = new URLSearchParams(location.search).get('scenario');
  return scenarios.find((s) => s.id === id) ?? scenarios[0];
}
