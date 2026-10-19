import { describe, expect, it } from 'vitest';
import { parseCommand } from './flow.js';

describe('parseCommand', () => {
  it('reads design commands', () => {
    expect(parseCommand('/design a checkout flow')).toEqual({ cmd: 'design', arg: 'a checkout flow' });
    expect(parseCommand('/review full')).toEqual({ cmd: 'review', arg: 'full' });
    expect(parseCommand('/buildcheck http://localhost:3000 1:2')).toEqual({ cmd: 'buildcheck', arg: 'http://localhost:3000 1:2' });
    expect(parseCommand('/compact')).toBeNull();
    expect(parseCommand('make it bigger')).toBeNull();
  });
});
