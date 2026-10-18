import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSketch, pickDirection, readSketch } from './sketch.js';

let dir = '';
const dirs = (...names: string[]) => names.map((name, i) => ({ id: String.fromCharCode(97 + i), name, rationale: `${name} because`, items: [] }));
const doc = () => ({ screens: [
  { id: 'cart', name: 'Cart', chosen: 'a', directions: dirs('Classic list', 'Delivery first') },
  { id: 'empty', name: 'Empty cart', directions: dirs('Suggestions', 'Plain', 'Search') },
] });

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'sketch-'));
  await writeFile(path.join(dir, 'sketch.json'), JSON.stringify(doc()));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('parseSketch', () => {
  it('reads old files without a reason, rejected or time', () => {
    const s = parseSketch(doc()).screens[0];
    expect(s.chosenBy).toBe('claude');
    expect(s).not.toHaveProperty('reason');
    expect(s).not.toHaveProperty('rejected');
    expect(s).not.toHaveProperty('at');
  });

  it('keeps a clean one-line reason and drops pick fields on unpicked screens', () => {
    const raw = doc();
    Object.assign(raw.screens[0], { chosenBy: 'designer', reason: '  Faster\n to scan  ', rejected: ['Delivery first', 5, ''], at: 10 });
    Object.assign(raw.screens[1], { reason: 'stale', at: 3 });
    const [a, b] = parseSketch(raw).screens;
    expect(a).toMatchObject({ reason: 'Faster to scan', rejected: ['Delivery first'], at: 10 });
    expect(b).not.toHaveProperty('reason');
    expect(b).not.toHaveProperty('at');
  });
});

describe('pickDirection', () => {
  it('records the reason, the rejected directions and the time', async () => {
    await pickDirection(dir, 'empty', 'b', 'Calmer when the cart is empty', 100);
    const s = (await readSketch(dir))!.screens[1];
    expect(s).toMatchObject({ chosen: 'b', chosenBy: 'designer', reason: 'Calmer when the cart is empty', rejected: ['Suggestions', 'Search'], at: 100 });
  });

  it('keeps earlier reasons when another screen is picked', async () => {
    await pickDirection(dir, 'empty', 'b', 'Calmer', 100);
    await pickDirection(dir, 'cart', 'b', 'Delivery matters most', 200);
    const saved = JSON.parse(await readFile(path.join(dir, 'sketch.json'), 'utf8'));
    expect(saved.screens[1].reason).toBe('Calmer');
    expect(saved.screens[0].reason).toBe('Delivery matters most');
  });

  it('confirms a pick by Claude and keeps the time when only the reason changes', async () => {
    await pickDirection(dir, 'cart', 'a', 'Fastest to scan', 100);
    expect((await readSketch(dir))!.screens[0]).toMatchObject({ chosenBy: 'designer', at: 100, reason: 'Fastest to scan' });
    await pickDirection(dir, 'cart', 'a', 'Fastest to scan for long carts', 200);
    expect((await readSketch(dir))!.screens[0]).toMatchObject({ at: 100, reason: 'Fastest to scan for long carts' });
    await pickDirection(dir, 'cart', 'a', undefined, 300);
    expect((await readSketch(dir))!.screens[0].reason).toBe('Fastest to scan for long carts');
  });

  it('drops the old reason when the direction changes without a new one', async () => {
    await pickDirection(dir, 'cart', 'a', 'Fastest to scan', 100);
    await pickDirection(dir, 'cart', 'b', undefined, 200);
    const s = (await readSketch(dir))!.screens[0];
    expect(s).toMatchObject({ chosen: 'b', at: 200, rejected: ['Classic list'] });
    expect(s).not.toHaveProperty('reason');
  });

  it('caps the reason at 200 characters', async () => {
    await pickDirection(dir, 'cart', 'a', 'x'.repeat(500), 1);
    expect((await readSketch(dir))!.screens[0].reason).toHaveLength(200);
  });

  it('rejects an unknown direction', async () => {
    await expect(pickDirection(dir, 'cart', 'z')).rejects.toThrow('No such sketch direction');
  });
});
