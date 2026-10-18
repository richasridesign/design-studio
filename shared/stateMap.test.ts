import { describe, expect, it } from 'vitest';
import { missingPrompt, parseStates, stateMap, type StateFrame } from './stateMap.js';

const SAMPLE = `# Grocery app: cart

## Screens
### Cart
Item rows and a Check out button.

## States
- Cart: default, updating quantity, invalid promo code, payment failed.
- Empty cart: default, signed out.

## Assumptions
- One promo code per order.
`;

const f = (nodeId: string, screen?: string, state?: string, name?: string): StateFrame => ({ nodeId, screen, state, name });
const designed = (md: string, frames: StateFrame[]) =>
  Object.fromEntries(stateMap(md, frames).screens.flatMap((s) => s.states.map((x) => [`${s.screen}: ${x.state}`, x.frame?.nodeId ?? null])));

describe('parseStates', () => {
  it('reads one line per screen from the States section', () => {
    expect(parseStates(SAMPLE)).toEqual([
      { screen: 'Cart', states: ['default', 'updating quantity', 'invalid promo code', 'payment failed'] },
      { screen: 'Empty cart', states: ['default', 'signed out'] },
    ]);
  });

  it('is empty when the brief has no States section', () => {
    expect(parseStates('# Brief\n\n## Screens\n- Cart: list')).toEqual([]);
    expect(parseStates('')).toEqual([]);
  });

  it('reads "States per screen", bold names, "and", notes in brackets and a dash separator', () => {
    const md = '## States per screen\n- **Home**: empty, loading (skeleton), and error\n- Profile - default; no permission\n## Layout\n- Cart: ignored';
    expect(parseStates(md)).toEqual([
      { screen: 'Home', states: ['empty', 'loading', 'error'] },
      { screen: 'Profile', states: ['default', 'no permission'] },
    ]);
  });

  it('reads sub-headings and nested bullets as screens', () => {
    const md = '## States\n### Cart\n- default\n- Error: payment failed\n\n## Other';
    expect(parseStates(md)).toEqual([{ screen: 'Cart', states: ['default', 'Error: payment failed'] }]);
    expect(parseStates('## States\n- Checkout\n  - default\n  - card declined\n- Cart: empty')).toEqual([
      { screen: 'Checkout', states: ['default', 'card declined'] },
      { screen: 'Cart', states: ['empty'] },
    ]);
  });

  it('drops screen ids, so "S1 Cart" and "S1 (Cart)" are the screen Cart', () => {
    const md = '## States per screen\n- **S1 Cart**: default, loading\n- S2 (Checkout): default\n- Profile (S3): error\n- S4 \u00b7 Search: empty\n- S5 - Help: default\n- 404 page: default';
    expect(parseStates(md).map((s) => s.screen)).toEqual(['Cart', 'Checkout', 'Profile', 'Search', 'Help', '404 page']);
    expect(parseStates('## States\n### S1: Cart\n- default')).toEqual([{ screen: 'Cart', states: ['default'] }]);
  });

  it('names a screen from the Screens list when the States line only gives its id', () => {
    const md = '## Screens\n- S1 Cart: item rows and a total\n- S2: Checkout\n### S3 \u00b7 Order placed\n| S4 | Help | FAQ |\n\n## States per screen\n- S1: default, loading\n- S2 - default, error\n- S4: default\n### S3\n- success';
    expect(parseStates(md)).toEqual([
      { screen: 'Cart', states: ['default', 'loading'] },
      { screen: 'Checkout', states: ['default', 'error'] },
      { screen: 'Help', states: ['default'] },
      { screen: 'Order placed', states: ['success'] },
    ]);
    expect(designed(md, [f('7:1', 'cart', 'default', 'Cart / Default')])['Cart: default']).toBe('7:1');
  });

  it('matches frames named after the screen when the brief gives it an id', () => {
    const map = designed('## States per screen\n- S1 Cart: default, loading', [f('9:1', 'S1', 'default', 'Cart / Default'), f('9:2', undefined, undefined, 'Cart / Loading')]);
    expect(map).toEqual({ 'Cart: default': '9:1', 'Cart: loading': '9:2' });
  });

  it('keeps a state and its note as one state, so commas in the note are not new states', () => {
    const md = '## States per screen\n- **Cart**\n  - Empty: no items, browse button\n  - Loading: skeleton\n- Checkout\n  - States: default, card declined';
    expect(parseStates(md)).toEqual([
      { screen: 'Cart', states: ['Empty: no items, browse button', 'Loading: skeleton'] },
      { screen: 'Checkout', states: ['default', 'card declined'] },
    ]);
    expect(designed(md, [f('8:1', 'Cart', 'empty')])['Cart: Empty: no items, browse button']).toBe('8:1');
  });

  it('reads a note after a dash as a note, so no dash reaches the map or the message box', () => {
    expect(parseStates('## States\n### Checkout\n- Card declined \u2014 error under the card field\n- Submitting - fields locked')).toEqual([
      { screen: 'Checkout', states: ['Card declined: error under the card field', 'Submitting: fields locked'] },
    ]);
  });

  it('reads numbered and bold headings', () => {
    expect(parseStates('## 4. States per screen\n- Cart: default, error')).toEqual([{ screen: 'Cart', states: ['default', 'error'] }]);
    expect(parseStates('**States per screen**\n- Cart: default\n\n**Layout**\n- Home: ignored')).toEqual([{ screen: 'Cart', states: ['default'] }]);
    expect(parseStates('## States\n**Cart**\n- default\n- loading')).toEqual([{ screen: 'Cart', states: ['default', 'loading'] }]);
  });

  it('reads tables: a States column, one state per row, or check marks per state', () => {
    expect(parseStates('## States\n| Screen | States |\n|---|---|\n| Cart | default, loading |\n| Checkout | default |')).toEqual([
      { screen: 'Cart', states: ['default', 'loading'] },
      { screen: 'Checkout', states: ['default'] },
    ]);
    expect(parseStates('## States\n| Screen | State | Notes |\n|---|---|---|\n| Cart | Default | items |\n| Cart | Error | payment failed, retry |')).toEqual([{ screen: 'Cart', states: ['Default', 'Error'] }]);
    expect(parseStates('## States\n| Screen | Default | Loading | Error |\n|---|:-:|---|---|\n| Cart | \u2713 | \u2713 | \u2013 |\n| Checkout | yes | | x |')).toEqual([
      { screen: 'Cart', states: ['Default', 'Loading'] },
      { screen: 'Checkout', states: ['Default', 'Error'] },
    ]);
  });

  it('merges a screen listed twice and drops repeated states', () => {
    expect(parseStates('## States\n- Cart: default, Default\n- cart: error')).toEqual([{ screen: 'Cart', states: ['default', 'error'] }]);
  });
});

describe('stateMap', () => {
  it('marks every state missing when nothing is designed', () => {
    const map = stateMap(SAMPLE, []);
    expect(map).toMatchObject({ total: 6, missing: 6, named: false });
  });

  it('is empty with no States section', () => {
    expect(stateMap('# Brief', [f('1:1', 'cart', 'default')])).toEqual({ screens: [], total: 0, missing: 0, named: true });
  });

  it('matches design.json screen ids and states, whatever the case and punctuation', () => {
    const map = designed(SAMPLE, [f('1:1', 'cart', 'default', 'Cart / Default'), f('1:2', 'cart', 'payment-failed'), f('1:3', 'empty-cart', 'signedOut')]);
    expect(map).toEqual({
      'Cart: default': '1:1', 'Cart: updating quantity': null, 'Cart: invalid promo code': null, 'Cart: payment failed': '1:2',
      'Empty cart: default': null, 'Empty cart: signed out': '1:3',
    });
  });

  it('does not count an Empty cart frame as a Cart state', () => {
    const map = designed(SAMPLE, [f('2:1', undefined, undefined, 'Empty cart / Default')]);
    expect(map['Cart: default']).toBeNull();
    expect(map['Empty cart: default']).toBe('2:1');
  });

  it('matches names only, in any word order and word form', () => {
    const map = designed(SAMPLE, [f('3:1', undefined, undefined, 'Cart, quantity updated'), f('3:2', undefined, undefined, 'Cart - Payment Failed'), f('3:3', undefined, undefined, 'Cart')]);
    expect(map['Cart: updating quantity']).toBe('3:1');
    expect(map['Cart: payment failed']).toBe('3:2');
    expect(map['Cart: default']).toBe('3:3');
  });

  it('accepts a shorter frame name, but uses each frame once', () => {
    const md = '## States\n- Cart: promo error, payment error';
    const map = designed(md, [f('4:1', 'Cart', 'error')]);
    expect(Object.values(map).filter(Boolean)).toEqual(['4:1']);
    expect(designed(SAMPLE, [f('4:2', 'Cart', 'invalid promo')])['Cart: invalid promo code']).toBe('4:2');
  });

  it('accepts a frame that says more than the brief', () => {
    expect(designed('## States\n- Cart: error', [f('5:1', 'Cart', 'error, payment declined')])['Cart: error']).toBe('5:1');
  });

  it('says when frames have no names to match', () => {
    expect(stateMap(SAMPLE, [{ nodeId: '12:3' }, { nodeId: '12:4' }])).toMatchObject({ missing: 6, named: false });
  });

  it('shows the frame name of a designed state', () => {
    const map = stateMap(SAMPLE, [f('1:1', 'cart', 'default')]);
    expect(map.screens[0].states[0]).toEqual({ state: 'default', frame: { nodeId: '1:1', name: 'cart / default' } });
  });
});

describe('missingPrompt', () => {
  it('asks for a plan first and names the frames so the map can find them', () => {
    const map = stateMap(SAMPLE, [f('1:1', 'cart', 'default'), f('1:2', 'cart', 'updating quantity'), f('1:3', 'cart', 'invalid promo code')]);
    expect(missingPrompt(map.screens[0])).toBe('Design the missing state for Cart: payment failed. Name each frame "Cart / <State>" and add it to design.json. Plan it first and wait for my approval.');
    expect(missingPrompt(map.screens[1])).toBe('Design the missing states for Empty cart: default, signed out. Name each frame "Empty cart / <State>" and add it to design.json. Plan them first and wait for my approval.');
  });

  it('separates states that carry a note with semicolons', () => {
    expect(missingPrompt({ screen: 'Cart', states: [{ state: 'Empty: no items, browse button' }, { state: 'Loading: skeleton' }] })).toContain('for Cart: Empty: no items, browse button; Loading: skeleton.');
  });

  it('is empty when nothing is missing', () => {
    expect(missingPrompt({ screen: 'Cart', states: [{ state: 'default', frame: { nodeId: '1:1', name: 'Cart' } }] })).toBe('');
  });
});
