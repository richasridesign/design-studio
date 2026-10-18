import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkFlows, hasClick, hasHover, reactionsOf, readFlowChecks, runFlowCheck } from './flowcheck.js';
import { flowFixPrompt, flowLabel } from '../../shared/flowcheck.js';

// Fixtures follow the REST shape from figma/rest-api-spec (Interaction = { trigger, actions }, NodeAction =
// { type: 'NODE', destinationId, navigation }), plus the Plugin API `reactions` shape for the same links.
let seq = 0;
const box = (x: number, y: number, width: number, height: number) => ({ absoluteBoundingBox: { x, y, width, height } });
const click = (dest: string | null = 's2', navigation = 'NAVIGATE') => ({ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: dest, navigation, transition: null }] });
const hover = () => ({ trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: 'c:hover', navigation: 'CHANGE_TO', transition: null }] });
const text = (characters: string) => ({ id: `t${++seq}`, type: 'TEXT', name: characters, characters });
const icon = (name = 'Icon') => ({ id: `v${++seq}`, type: 'INSTANCE', name, componentId: 'c:icon', children: [] });
const button = (label: string, extra: any = {}) => ({ id: `b${++seq}`, type: 'INSTANCE', name: 'Button', componentId: 'c:btn', children: [text(label)], ...extra });
const screen = (id: string, name: string, children: any[], x = 0, y = 0) => ({ id, type: 'FRAME', name, ...box(x, y, 1440, 900), children });
const sticky = (n: number, name: string) => ({ id: `k${++seq}`, type: 'STICKY', name: `Decision ${n} · ${name}`, characters: 'Why: test' });
const section = (id: string, name: string, children: any[], x = 0, y = 0, w = 4000, h = 2000) => ({ id, type: 'SECTION', name, ...box(x, y, w, h), children });
const doc = (...pages: any[][]) => ({ id: '0:0', type: 'DOCUMENT', children: pages.map((children, i) => ({ id: `0:${i + 1}`, type: 'CANVAS', name: `Page ${i + 1}`, children })) });
const maps = { components: { 'c:btn': { name: 'Type=Primary, State=Default' }, 'c:btnHover': { name: 'Type=Primary, State=Hover' }, 'c:icon': { name: 'Icon' }, 'c:iconbtn': { name: 'Icon button' }, 'c:row': { name: 'Workflow row' } }, componentSets: {} };

const rules = (r: ReturnType<typeof checkFlows>, flow = 0) => r.flows[flow].findings.map((f) => f.rule);

describe('reactionsOf', () => {
  it('reads the REST interactions shape', () => {
    const n = { interactions: [click('1:2'), hover()] };
    expect(reactionsOf(n)).toEqual([
      { kind: 'click', actions: [{ type: 'NODE', destinationId: '1:2', navigation: 'NAVIGATE' }] },
      { kind: 'hover', actions: [{ type: 'NODE', destinationId: 'c:hover', navigation: 'CHANGE_TO' }] },
    ]);
  });
  it('reads Plugin API reactions with actions or a single action, and legacy transitionNodeID', () => {
    expect(hasClick({ reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'BACK' }] }] })).toBe(true);
    expect(hasClick({ reactions: [{ trigger: { type: 'ON_PRESS' }, action: { type: 'NODE', destinationId: '1:2', navigation: 'NAVIGATE' } }] })).toBe(true);
    expect(hasHover({ reactions: [{ trigger: { type: 'MOUSE_ENTER', delay: 0 }, action: { type: 'NODE', destinationId: '1:2', navigation: 'OVERLAY' } }] })).toBe(true);
    expect(reactionsOf({ transitionNodeID: '9:9' })).toEqual([{ kind: 'click', actions: [{ type: 'NODE', destinationId: '9:9', navigation: 'NAVIGATE' }] }]);
  });
  it('ignores null triggers and triggers with no actions, and flattens conditionals', () => {
    expect(hasClick({ interactions: [{ trigger: null, actions: [{ type: 'BACK' }] }, { trigger: { type: 'ON_CLICK' }, actions: [] }] })).toBe(false);
    const cond = { interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'CONDITIONAL', conditionalBlocks: [{ actions: [{ type: 'NODE', destinationId: '3:3', navigation: 'NAVIGATE' }] }] }] }] };
    expect(reactionsOf(cond)[0].actions[0].destinationId).toBe('3:3');
  });
});

describe('checkFlows', () => {
  const wired = () => button('Save', { interactions: [click(), hover()] });

  it('passes a fully wired flow with its stickies', () => {
    const r = checkFlows(doc([section('1:1', 'Flow 1', [screen('s1', 'Home', [wired()]), screen('s2', 'Done', [], 0, 1000), sticky(1, 'Home'), sticky(2, 'Home'), sticky(1, 'Done'), sticky(2, 'Done')])]), maps);
    expect(r.flows).toHaveLength(1);
    expect(r.flows[0]).toMatchObject({ name: 'Flow 1', state: 'pass', screens: 2, findings: [] });
    expect(flowLabel(r.flows[0])).toBe('Passed');
  });

  it('flags a button with no click and no hover (REST shape)', () => {
    const r = checkFlows(doc([section('1:1', 'Flow 1', [screen('s1', 'Home', [button('Save')])])]), maps);
    expect(rules(r)).toEqual(['no-click', 'no-hover']);
    expect(r.flows[0].findings[0]).toMatchObject({ severity: 'major', screen: { id: 's1', name: 'Home' }, flow: { id: '1:1', name: 'Flow 1' } });
    expect(r.flows[0].state).toBe('fail');
  });

  it('accepts the Plugin API reactions shape for click and hover', () => {
    const b = button('Save', { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'NODE', destinationId: 's2', navigation: 'NAVIGATE' } }, { trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: 'c:hover', navigation: 'CHANGE_TO' }] }] });
    expect(rules(checkFlows(doc([section('1:1', 'Flow 1', [screen('s1', 'Home', [b])])]), maps))).toEqual([]);
  });

  it('skips Hover, Disabled and Selected variants', () => {
    const b = { ...button('Save'), componentId: 'c:btnHover' };
    const tab = { id: 'tab', type: 'INSTANCE', name: 'Tab', componentId: 'x', componentProperties: { State: { type: 'VARIANT', value: 'Selected' } }, children: [text('Evals')] };
    expect(rules(checkFlows(doc([section('1:1', 'Flow 1', [screen('s1', 'Home', [b, tab])])]), maps))).toEqual([]);
  });

  it('lets one wired example cover repeated copies, and groups unwired copies into one finding', () => {
    const rowsWired = [1, 2, 3].map((i) => button('Connect', i === 1 ? { interactions: [click(), hover()] } : { interactions: [hover()] }));
    expect(rules(checkFlows(doc([section('1:1', 'Flow 1', [screen('s1', 'Home', rowsWired)])]), maps))).toEqual([]);
    const rowsBare = [1, 2, 3].map(() => button('Connect', { interactions: [hover()] }));
    const r = checkFlows(doc([section('1:1', 'Flow 1', [screen('s1', 'Home', rowsBare)])]), maps);
    expect(rules(r)).toEqual(['no-click']);
    expect(r.flows[0].findings[0].message).toContain('and 2 more like it');
  });

  it('does not flag controls inside a clickable card, and flags a card with no click anywhere', () => {
    const card = (extra: any) => ({ id: `card${++seq}`, type: 'INSTANCE', name: 'Colleague card', componentId: 'c:card', children: [text('Atlas')], ...extra });
    const inner = button('Open', { interactions: [hover()] });
    expect(rules(checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', [card({ interactions: [click()], children: [inner] })])])]), maps))).toEqual([]);
    expect(rules(checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', [card({})])])]), maps))).toEqual(['no-click']);
  });

  it('ignores plain frames named like containers', () => {
    const f = { id: 'f1', type: 'FRAME', name: 'Title row', children: [text('Hi')] };
    const bar = { id: 'f2', type: 'FRAME', name: 'Tab bar', children: [] };
    expect(rules(checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', [f, bar])])]), maps))).toEqual([]);
  });

  it('flags an icon-only button with no hover as no-tooltip, not no-hover', () => {
    const ib = { id: 'ib', type: 'INSTANCE', name: 'Icon button', componentId: 'c:iconbtn', interactions: [click()], children: [icon('history')] };
    const r = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', [ib])])]), maps);
    expect(rules(r)).toEqual(['no-tooltip']);
    expect(r.flows[0].findings[0].severity).toBe('minor');
  });

  it('flags a dialog with no close icon, and passes one with a close icon', () => {
    const dialog = (children: any[]) => ({ id: `d${++seq}`, type: 'INSTANCE', name: 'Dialog', componentId: 'c:dialog', children: [{ id: `h${++seq}`, type: 'FRAME', name: 'Dialog header', children: [text('Disconnect HRIS')] }, ...children] });
    const open = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Disconnect', [dialog([])])])]), maps);
    expect(rules(open)).toEqual(['no-close']);
    expect(open.flows[0].findings[0].severity).toBe('major');
    const closeBtn = { id: 'x1', type: 'INSTANCE', name: 'Icon/x', componentId: 'c:icon', interactions: [click('s0'), hover()], children: [] };
    expect(rules(checkFlows(doc([section('1:1', 'F', [screen('s1', 'Disconnect', [dialog([closeBtn])])])]), maps))).toEqual([]);
  });

  it('checks a screen that is itself a drawer', () => {
    const r = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Side sheet · Test as employee', [text('Body')])])]), maps);
    expect(rules(r)).toEqual(['no-close']);
  });

  it('flags a link into a screen in another section as an old link (both shapes)', () => {
    const rest = button('Next', { interactions: [click('old1'), hover()] });
    const plugin = button('Back', { reactions: [{ trigger: { type: 'ON_CLICK' }, action: { type: 'NODE', destinationId: 'old1', navigation: 'OVERLAY' } }, { trigger: { type: 'ON_HOVER' }, actions: [{ type: 'BACK' }] }] });
    const r = checkFlows(doc([section('1:1', 'V4 · Flow 1', [screen('s1', 'Home', [rest, plugin])]), section('2:1', 'V3 · Flow 1', [screen('old1', 'Home', [], 0, 3000)], 0, 3000)]), maps);
    expect(rules(r)).toEqual(['stale-link', 'stale-link']);
    expect(r.flows[0].findings[0].message).toBe('"Button" opens "Home" in "V3 · Flow 1", outside this flow.');
  });

  it('does not treat hover CHANGE_TO variants or unknown destinations as old links', () => {
    const b = button('Next', { interactions: [click('elsewhere'), { trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: 'old1', navigation: 'CHANGE_TO' }] }] });
    const r = checkFlows(doc([section('1:1', 'Flow', [screen('s1', 'Home', [b])]), section('2:1', 'Old', [screen('old1', 'Home', [], 0, 3000)], 0, 3000)]), maps);
    expect(rules(r)).toEqual([]);
  });

  it('flags a branch section linking into the main section (literal different-section rule)', () => {
    const b = button('Back', { interactions: [click('main1'), hover()] });
    const r = checkFlows(doc([section('L', 'LATEST', [section('m', 'Flow 2 · Main', [screen('main1', 'Home', [])], 0, 0, 2000, 1000), section('br', 'Flow 2 · Voice and attach', [screen('v1', 'Voice', [b], 0, 1200)], 0, 1200, 2000, 1000)], 0, 0, 3000, 3000)]), maps);
    const branch = r.flows.find((f) => f.id === 'br')!;
    expect(branch.findings.map((f) => f.rule)).toEqual(['stale-link']);
  });

  it('flags overlapping screens and a screen poking out of its section, and ignores touching edges', () => {
    const r = checkFlows(doc([section('1:1', 'F', [screen('a', 'A', []), screen('b', 'B', [], 1000, 0), screen('c', 'C', [], 1440 + 1000, 0), screen('d', 'D', [], 3800, 1500)])]), maps);
    const msgs = r.flows[0].findings.filter((f) => f.rule === 'overlap').map((f) => f.message);
    expect(msgs).toEqual(['"A" overlaps "B" on the canvas.', '"D" sits partly outside its section "F".']);
  });

  it('flags overlapping sibling sections once, not once per screen', () => {
    const r = checkFlows(doc([section('1:1', 'Flow 1', [screen('a', 'A', [])], 0, 0, 2000, 1000), section('2:1', 'Flow 2', [screen('b', 'B', [], 0, 900)], 0, 900, 2000, 1000)]), maps);
    const all = r.flows.flatMap((f) => f.findings.filter((x) => x.rule === 'overlap').map((x) => x.message));
    expect(all).toEqual(['"Flow 1" overlaps "Flow 2" on the canvas.']);
  });

  it('checks the two Decision stickies per screen, with truncated names', () => {
    const r = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Connectors: HRIS connected', []), screen('s2', 'Done', [], 0, 1000), sticky(1, 'Connectors: HRIS…'), sticky(2, 'Connectors: HRIS connected'), sticky(1, 'Done')], 0, 0, 4000, 3000)]), maps);
    const f = r.flows[0].findings;
    expect(f.map((x) => x.rule)).toEqual(['no-stickies']);
    expect(f[0].message).toBe('"Done" is missing Decision 2.');
    expect(r.unchecked).toEqual([]);
  });

  it('does not match a sticky for a longer screen name to a shorter one', () => {
    const r = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', []), sticky(1, 'Home filled'), sticky(2, 'Home filled')])]), maps);
    expect(rules(r)).toEqual(['no-stickies']);
  });

  it('marks stickies as not checked when the file has no Decision nodes', () => {
    const r = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', [])])]), maps);
    expect(r.unchecked).toEqual(['no-stickies']);
    expect(r.flows[0]).toMatchObject({ state: 'pass', unchecked: ['no-stickies'] });
  });

  it('does not count Decision instances, notes or small frames as screens', () => {
    const dec = { id: 'di', type: 'INSTANCE', name: 'Decision 1 · Home', componentId: 'c:dec', ...box(0, 1000, 300, 300), children: [] };
    const note = { id: 'n1', type: 'FRAME', name: 'Note', ...box(1500, 0, 400, 400), children: [] };
    const r = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', []), dec, note, sticky(2, 'Home')])]), maps);
    expect(r.flows[0].screens).toBe(1);
    expect(r.flows[0].state).toBe('pass');
  });

  it('lists loose screens on a page with sections, and skips pages without sections', () => {
    const r = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', [])]), screen('loose', 'Stray', [button('Go')], 5000, 0)], [screen('comp', 'Components', [button('Go')])]), maps);
    expect(r.flows.map((f) => f.name)).toEqual(['F', 'Not in a section (Page 1)']);
    expect(r.flows[1].findings.map((f) => f.rule)).toEqual(['no-click', 'no-hover']);
  });

  it('shows an empty leaf section as not checked', () => {
    const r = checkFlows(doc([section('1:1', 'Parked', [])]), maps);
    expect(r.flows[0]).toMatchObject({ state: 'unchecked' });
    expect(flowLabel(r.flows[0])).toBe('Not checked');
  });

  it('caps stored findings per flow but keeps full counts', () => {
    const many = Array.from({ length: 130 }, (_, i) => button(`Item ${i}`));
    const r = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', many)])]), maps);
    expect(r.flows[0].counts['no-click']).toBe(130);
    expect(r.flows[0].findings).toHaveLength(100);
    expect(r.flows[0].more).toBe(160);
    expect(flowLabel(r.flows[0])).toBe('260 issues');
  });
});

describe('flowFixPrompt', () => {
  it('asks for a plan first and lists findings with node ids', () => {
    const r = checkFlows(doc([section('1:1', 'Flow 1', [screen('s1', 'Home', [button('Save', { id: '5:6', interactions: [hover()] })])]), section('2:1', 'Flow 2', [screen('s2', 'Done', [], 0, 3000)], 0, 3000)]), maps);
    const text = flowFixPrompt({ id: 'r', at: 0, fileKey: 'abc', flows: r.flows, unchecked: r.unchecked });
    expect(text).toContain('wait for my approval before you edit anything');
    expect(text).toContain('Flow 1 (section 1:1 https://www.figma.com/design/abc?node-id=1-1):');
    expect(text).toContain('- [no-click] Home: "Button" looks clickable but has no click. Fix:');
    expect(text).toContain('(node 5:6)');
    expect(text).not.toContain('Flow 2');
    expect(text).not.toMatch(/\u2014/);
  });
});

describe('runFlowCheck', () => {
  it('stores the run in flowcheck.json', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    const load = async () => ({ document: doc([section('1:1', 'F', [screen('s1', 'Home', [button('Go')])])]), maps });
    const run = await runFlowCheck({ dir, fileKey: 'abc', load });
    expect(run.flows[0].counts).toEqual({ 'no-click': 1, 'no-hover': 1 });
    expect((await readFlowChecks(dir)).map((x) => x.id)).toEqual([run.id]);
    expect(JSON.parse(await readFile(path.join(dir, 'flowcheck.json'), 'utf8')).runs).toHaveLength(1);
  });
  it('returns no flows for the sample file without calling Figma', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    const run = await runFlowCheck({ dir, fileKey: 'sample', load: async () => { throw new Error('no'); } });
    expect(run.flows).toEqual([]);
  });
});
