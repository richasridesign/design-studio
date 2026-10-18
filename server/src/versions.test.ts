import { describe, expect, it } from 'vitest';
import { mapVersions } from './figma.js';

describe('mapVersions', () => {
  const raw = [
    { id: '1', created_at: '2026-10-01T10:00:00Z', label: 'Handoff', description: null, user: { handle: 'ann' } },
    { id: '2', created_at: '2026-10-03T10:00:00Z', label: 'Design Studio: tidy cards', description: '', user: { handle: 'ann' } },
    { id: '3', created_at: '2026-10-02T10:00:00Z', label: null, description: 'Design Studio: review fixes 1', user: { handle: 'bo' } },
    { id: '4', created_at: '2026-10-04T10:00:00Z', label: 'Before Design Studio', description: '' },
  ];
  const out = mapVersions(raw);

  it('sorts newest first', () => expect(out.map((v) => v.id)).toEqual(['4', '2', '3', '1']));
  it('flags checkpoints by label or description prefix', () => expect(out.map((v) => v.checkpoint)).toEqual([false, true, true, false]));
  it('fills missing fields', () => expect(out[0]).toMatchObject({ user: 'Unknown', description: '' }));
  it('maps the user handle', () => expect(out[3]).toMatchObject({ label: 'Handoff', user: 'ann', description: '' }));
});
