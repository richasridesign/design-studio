import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkFlows, hasClick, hasHover, reactionsOf, readFlowChecks, runFlowCheck } from './flowcheck.js';
import { hoverDrift, screenFindings } from './flowRules.js';
import { flowFixPrompt, flowLabel, wiringIssues } from '../../shared/flowcheck.js';

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
const scope = (flows: string[], parked: string[] = []) => ({ flows, parked: parked.map((name) => ({ name, why: 'Not in the MVP', restore: '', at: 1 })) });
// A wired button with a hover, so only the scope rules can fail.
const ok = (label: string, dest = 's2', extra: any = {}) => button(label, { interactions: [click(dest), hover()], ...extra });

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

  it('lets one wired row cover its copies, even when each row is a different variant of the set', () => {
    const rowMaps = { ...maps, components: { ...maps.components, 'c:rowA': { name: 'Decider=Person', componentSetId: 'set:row' }, 'c:rowB': { name: 'Decider=Team', componentSetId: 'set:row' } }, componentSets: { 'set:row': { name: 'Workflow row' } } };
    const row = (componentId: string, extra: any = {}) => ({ id: `row${++seq}`, type: 'INSTANCE', name: 'Workflow row', componentId, children: [text('Leave request')], ...extra });
    const rows = [row('c:rowA', { interactions: [click()] }), row('c:rowB'), row('c:rowA')];
    expect(rules(checkFlows(doc([section('1:1', 'F', [screen('s1', 'Workflows', rows)])]), rowMaps))).toEqual([]);
    expect(rules(checkFlows(doc([section('1:1', 'F', [screen('s1', 'Workflows', [row('c:rowA'), row('c:rowB')])])]), rowMaps))).toEqual(['no-click']);
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

  it('passes a dialog whose close sits in its header next to a part named like a dialog', () => {
    const closeBtn = { id: 'x2', type: 'INSTANCE', name: 'Icon/x', componentId: 'c:icon', interactions: [click('s0'), hover()], children: [] };
    const d = { id: 'd9', type: 'INSTANCE', name: 'Dialog', componentId: 'c:dialog', children: [{ id: 'h9', type: 'FRAME', name: 'Dialog header', children: [text('Invite'), closeBtn] }, { id: 'f9', type: 'FRAME', name: 'Dialog buttons', children: [] }] };
    expect(rules(checkFlows(doc([section('1:1', 'F', [screen('s1', 'Invite', [d])])]), maps))).toEqual([]);
  });

  it('points a dialog screen with no close at the dialog inside it', () => {
    const d = { id: 'd10', type: 'INSTANCE', name: 'Dialog', componentId: 'c:dialog', children: [text('Disconnect')] };
    const r = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Disconnect dialog', [d])])]), maps);
    expect(r.flows[0].findings.map((f) => [f.rule, f.nodeId])).toEqual([['no-close', 'd10']]);
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
    expect(r.flows[0].findings[0].message).toBe('Button "Next" opens "Home" in "V3 · Flow 1", outside this flow.');
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
    const linked = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', [ok('Go', 'loose')])]), screen('loose', 'Stray', [], 5000, 0)]), maps);
    expect(linked.flows[1].findings).toMatchObject([{ rule: 'loose-screen', nodeId: 'loose', severity: 'minor', message: '"Stray" sits loose on the canvas, outside any section.' }]);
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

describe('new screen rules', () => {
  const hoverTo = (dest: string) => ({ trigger: { type: 'ON_HOVER' }, actions: [{ type: 'NODE', destinationId: dest, navigation: 'CHANGE_TO' }] });
  const cards = {
    components: {
      'c:ready': { name: 'Status=Partly ready', componentSetId: 'set:card' },
      'c:readyHover': { name: 'Status=Partly ready Hover', componentSetId: 'set:card' },
      'c:setupHover': { name: 'Status=Needs setup Hover', componentSetId: 'set:card' },
      'c:none': { name: 'Decider=None, State=Default', componentSetId: 'set:row' },
      'c:noneHover': { name: 'Decider=None, State=Hover', componentSetId: 'set:row' },
      'c:harHover': { name: 'Decider=Atlas, State=Hover', componentSetId: 'set:row' },
      'c:tabSel': { name: 'State=Selected', componentSetId: 'set:tab' },
      'c:tabHover': { name: 'State=Hover', componentSetId: 'set:tab' },
      'c:other': { name: 'State=Hover', componentSetId: 'set:other' },
    },
    componentSets: { 'set:card': { name: 'Colleague card' }, 'set:row': { name: 'Workflow row' }, 'set:tab': { name: 'Tab' }, 'set:other': { name: 'Chip' } },
  };
  const inst = (id: string, componentId: string, dest: string) => ({ id, type: 'INSTANCE', name: 'Card', componentId, interactions: [click('s9'), hoverTo(dest)], children: [] });
  const one = (children: any[], m: any = cards) => checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', children)])]), m);

  it('reads what a hover changes besides the state', () => {
    expect(hoverDrift('Type=Primary, State=Default', 'Type=Primary, State=Hover')).toEqual([]);
    expect(hoverDrift('Status=Partly ready', 'Status=Partly ready Hover')).toEqual([]);
    expect(hoverDrift('Status=Partly ready', 'Status=Needs setup Hover')).toEqual([{ key: 'Status', from: 'Partly ready', to: 'Needs setup Hover' }]);
    expect(hoverDrift('Decider=None, State=Default', 'Decider=Atlas, State=Hover')).toEqual([{ key: 'Decider', from: 'None', to: 'Atlas' }]);
    expect(hoverDrift('Size=Small, Show tooltip=False', 'Size=Small, Show tooltip=True')).toEqual([]);
    expect(hoverDrift('Icon', 'Icon hover')).toEqual([]);
  });

  it('flags a hover that goes to another status, decider or component set, and passes the right one', () => {
    expect(rules(one([inst('a', 'c:ready', 'c:readyHover'), inst('b', 'c:none', 'c:noneHover')]))).toEqual([]);
    const r = one([inst('a', 'c:ready', 'c:setupHover'), inst('a2', 'c:ready', 'c:setupHover'), inst('b', 'c:none', 'c:harHover'), inst('c', 'c:none', 'c:other')]);
    expect(rules(r)).toEqual(['wrong-hover', 'wrong-hover', 'wrong-hover']);
    const [a, b, c] = r.flows[0].findings;
    expect(a).toMatchObject({ nodeId: 'a', severity: 'major', message: '"Card" changes on hover to Status=Needs setup Hover, but its own is Status=Partly ready (and 1 more like it).', fix: 'Point While hovering to the Hover variant with Status=Partly ready and the same other properties.' });
    expect(b.message).toBe('"Card" changes on hover to Decider=Atlas, but its own is Decider=None.');
    expect(c.message).toBe('"Card" changes on hover to "State=Hover", a variant of another component.');
  });

  it('tells a selected tab to keep still on hover', () => {
    const r = one([inst('t', 'c:tabSel', 'c:tabHover')]);
    expect(r.flows[0].findings[0]).toMatchObject({ rule: 'wrong-hover', fix: 'A selected or disabled item stays as it is on hover: remove the While hovering reaction.' });
  });

  it('skips hover targets it cannot read', () => {
    expect(rules(one([inst('a', 'c:ready', 'c:unknown')]))).toEqual([]);
  });

  it('flags a close icon that does nothing, but not one inside a control already flagged as No click', () => {
    const dialog = (close: any) => ({ id: `d${++seq}`, type: 'INSTANCE', name: 'Dialog', componentId: 'c:dialog', children: [text('Disconnect HRIS'), close] });
    const dead = one([dialog({ id: 'x1', type: 'VECTOR', name: 'close' })], maps);
    expect(dead.flows[0].findings.map((f) => [f.rule, f.nodeId, f.message])).toEqual([['no-close', 'x1', 'The close icon in Dialog "Disconnect HRIS" does nothing when clicked.']]);
    const iconX = one([dialog({ id: 'x2', type: 'INSTANCE', name: 'Icon/x', componentId: 'c:icon', children: [] })], maps);
    expect(rules(iconX)).toEqual(['no-close']);
    const wired = one([dialog({ id: 'g', type: 'FRAME', name: 'Header actions', interactions: [click('s0')], children: [{ id: 'x3', type: 'VECTOR', name: 'close' }] })], maps);
    expect(rules(wired)).toEqual([]);
    const control = one([dialog({ id: 'x4', type: 'INSTANCE', name: 'Close button', componentId: 'c:iconbtn', children: [icon('x')] })], maps);
    expect(rules(control)).toEqual(['no-click', 'no-tooltip']);
  });

  it('checks a toast is 24px from the top, centred, and the top layer', () => {
    const toast = (id: string, x: number, y: number) => ({ id, type: 'INSTANCE', name: 'Toast', componentId: 'c:toast', ...box(x, y, 400, 48), children: [text('Saved')] });
    const s = (children: any[]) => checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', children)])]), maps);
    expect(rules(s([text('Body'), toast('t1', 520, 24)]))).toEqual([]);
    expect(rules(s([text('Body'), toast('t1', 520.4, 24.6)]))).toEqual([]);
    const off = s([toast('t2', 900, 820), text('Body')]);
    expect(off.flows[0].findings.map((f) => [f.rule, f.severity, f.message])).toEqual([['toast', 'minor', 'Toast "Saved" sits 820px from the top of the screen, 380px right of centre, under layers drawn after it.']]);
  });

  it('flags notes over 230 characters with no bullets, outside screens, stickies and the changelog', () => {
    const long = 'This flow shows how Richa activates the colleague after setup. '.repeat(5);
    const note = (id: string, characters: string, extra: any = {}) => ({ id, type: 'TEXT', name: 'Flow note', characters, ...extra });
    const r = checkFlows(doc([section('1:1', 'F', [
      screen('s1', 'Home', [note('in-screen', long)]),
      note('n1', long),
      note('n2', `• ${long}`),
      { id: 'k', type: 'INSTANCE', name: 'Decision 1 · Home', children: [note('n3', long)] },
      { id: 'cl', type: 'FRAME', name: 'Changelog', children: [note('n4', long)] },
      // From the plugin walker: the text is clipped, the length and bullet flag come with it.
      note('n5', 'Short clip', { textLength: 400, bullets: false }),
      note('n6', 'Short clip', { textLength: 400, bullets: true }),
    ])]), maps);
    const notes = r.flows[0].findings.filter((f) => f.rule === 'long-note');
    expect(notes.map((f) => f.nodeId)).toEqual(['n1', 'n5']);
    expect(notes[0]).toMatchObject({ screen: null, severity: 'minor', message: `The note "This flow shows how Richa activates the…" is ${long.trim().length + 1} characters with no bullets.` });
  });

  it('flags only loose screens that are part of a prototype, and skips notes in a changelog section', () => {
    const long = 'V2 · 9 Oct 2026. Rebuilt on the Flow 1 screens with the new connectors table and the toast at the top. '.repeat(3);
    const r = checkFlows(doc([
      section('1:1', 'F', [screen('s1', 'Home', [ok('Open', 'linkedIn')])]),
      section('2:1', 'Changelog · V1 to V2', [{ id: 'n1', type: 'TEXT', name: 'Log', characters: long }], 0, 3000),
      screen('linkedIn', 'Detail', [], 6000, 0),
      screen('linksOut', 'Settings', [ok('Back', 's1')], 6000, 1200),
      screen('thumb', 'Portfolio thumbnail', [], 6000, 2400),
    ]), maps);
    const loose = r.flows.find((f) => f.name.startsWith('Not in a section'))!.findings.filter((f) => f.rule === 'loose-screen');
    expect(loose.map((f) => f.nodeId)).toEqual(['linkedIn', 'linksOut']);
    expect(r.flows.find((f) => f.id === '2:1')!.findings).toEqual([]);
  });

  it('lets one wired chip cover the other chips of its set, and groups unwired chips into one finding', () => {
    const chip = (label: string, extra: any = {}) => ({ id: `ch${++seq}`, type: 'INSTANCE', name: 'Suggestion chip', componentId: 'c:chip', children: [text(label)], ...extra });
    const m = { ...maps, components: { ...maps.components, 'c:chip': { name: 'Chip', componentSetId: 'set:chip' } } };
    const wired = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', [chip('Track visas', { interactions: [click()] }), chip('Answer payroll')])])]), m);
    expect(rules(wired)).toEqual([]);
    const none = checkFlows(doc([section('1:1', 'F', [screen('s1', 'Home', [chip('Track visas'), chip('Answer payroll'), chip('Collect feedback')])])]), m);
    expect(none.flows[0].findings.map((f) => f.message)).toEqual(['Suggestion chip "Track visas" looks clickable but has no click (and 2 more like it).']);
  });

  it('keeps craft rules out of the Prototype wired gate', () => {
    const f = { id: 'f', name: 'F', path: [], page: 'P', screens: 1, state: 'fail' as const, counts: { toast: 1, 'long-note': 2, 'loose-screen': 1 }, unchecked: [], findings: [], more: 0 };
    expect(wiringIssues(f)).toBe(0);
    expect(wiringIssues({ ...f, counts: { ...f.counts, 'wrong-hover': 1 } })).toBe(1);
  });

  it('gives the Code scan the same per-screen findings with stable ids', () => {
    const s = screen('s1', 'Home', [inst('a', 'c:ready', 'c:setupHover')]);
    expect(screenFindings(s, cards).map((f) => f.id)).toEqual(['wrong-hover:a:c:setupHover']);
  });
});

describe('checkFlows with scope', () => {
  const parkedSection = (children: any[] = [screen('p1', 'Add a workflow', [], 0, 3000)]) => section('9:1', 'Parked', children, 0, 3000);

  it('flags a layer or text named like a parked feature in an in-scope flow, once per screen', () => {
    const r = checkFlows(doc([section('1:1', 'Home', [screen('s1', 'Home', [ok('Add-a-Workflow'), ok('Save'), text('add a workflow'), text('Add a workflow')])])]), maps, scope([], ['Add a workflow']));
    const f = r.flows[0].findings.filter((x) => x.rule === 'parked-link');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'major', fix: 'Remove the entry point, or restore the feature in Scope.' });
    expect(f[0].message).toBe('Button "Add-a-Workflow" is an entry point for the parked feature "Add a workflow" (and 2 more like it).');
  });

  it('flags a screen named like a parked feature left in an in-scope section', () => {
    const r = checkFlows(doc([section('1:1', 'Flow 2', [screen('s1', 'Add a workflow · Step 1', [])])]), maps, scope([], ['Add a workflow']));
    expect(r.flows[0].findings[0]).toMatchObject({ rule: 'parked-link', nodeId: 's1', message: '"Add a workflow · Step 1" is a screen for the parked feature "Add a workflow".' });
  });

  it('flags a link into a Parked section as a parked link, not an old link', () => {
    const b = ok('Next', 'p1', { name: 'Link' });
    const r = checkFlows(doc([section('1:1', 'Flow 2', [screen('s1', 'Home', [b])]), parkedSection()]), maps, scope([], ['Add a workflow']));
    const f = r.flows[0].findings;
    expect(f.map((x) => x.rule)).toEqual(['parked-link']);
    expect(f[0].message).toBe('Link "Next" opens "Add a workflow", part of the parked feature "Add a workflow".');
  });

  it('names the Parked section when the destination does not name the feature', () => {
    const b = ok('Next', 'p1', { name: 'Link' });
    const r = checkFlows(doc([section('1:1', 'Flow 2', [screen('s1', 'Home', [b])]), parkedSection([screen('p1', 'Step 1', [], 0, 3000)])]), maps, scope([], ['Bulk import']));
    expect(r.flows[0].findings[0].message).toBe('Link "Next" opens "Step 1", in the parked section "Parked".');
  });

  it('flags a link into a small overlay inside a section named like the feature', () => {
    const b = ok('Next', 'ov', { name: 'Link' });
    const overlay = { id: 'ov', type: 'FRAME', name: 'Menu', ...box(0, 3000, 200, 100), children: [] };
    const r = checkFlows(doc([section('1:1', 'Flow 2', [screen('s1', 'Home', [b])]), section('5:1', 'V3 · Add a workflow', [screen('w1', 'Add a workflow', [], 0, 3200), overlay], 0, 3000)]), maps, scope([], ['Add a workflow']));
    expect(rules(r)).toEqual(['parked-link']);
    expect(r.flows[0].findings[0].message).toBe('Link "Next" opens part of the parked feature "Add a workflow".');
  });

  it('does not scan the feature\'s own section for entry points, but still runs the normal rules there', () => {
    const r = checkFlows(doc([section('5:1', 'Add a workflow', [screen('w1', 'Add a workflow', [button('Add a workflow')])])]), maps, scope([], ['Add a workflow']));
    expect(rules(r)).toEqual(['no-click', 'no-hover']);
  });

  it('flags nothing extra without parked features', () => {
    const r = checkFlows(doc([section('1:1', 'Flow 2', [screen('s1', 'Home', [ok('Add a workflow')])])]), maps, scope(['Flow 2']));
    expect(rules(r)).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('skips Parked sections and their sub-sections, and lists them as not checked', () => {
    const inner = section('9:2', 'Add a workflow', [screen('p2', 'Step 2', [button('Go')], 0, 3000)], 0, 3000, 2000, 1000);
    const r = checkFlows(doc([section('1:1', 'Flow 2', [screen('s1', 'Home', [])]), section('9:1', 'Parked · 12 Oct', [screen('p1', 'Add a workflow', [button('Go')], 2000, 3000), inner], 0, 3000)]), maps, scope([], ['Add a workflow']));
    const parked = r.flows.filter((f) => f.skipped === 'parked');
    expect(parked.map((f) => f.name)).toEqual(['Parked · 12 Oct', 'Add a workflow']);
    expect(parked.every((f) => f.state === 'unchecked' && f.findings.length === 0)).toBe(true);
    expect(parked[0].screens).toBe(1);
    expect(flowLabel(parked[0])).toBe('Not checked');
  });

  it('skips Parked sections even without a scope', () => {
    const r = checkFlows(doc([section('9:1', 'Parked', [screen('p1', 'Old', [button('Go')])])]), maps);
    expect(r.flows[0]).toMatchObject({ state: 'unchecked', skipped: 'parked', findings: [] });
  });

  it('reports an overlap with a Parked section on the checked side, and none between parked items', () => {
    const r = checkFlows(doc([section('1:1', 'Flow 1', [screen('a', 'A', [])], 0, 0, 2000, 1000), section('9:1', 'Parked', [screen('b', 'B', [], 0, 900), screen('c', 'C', [], 0, 900)], 0, 900, 2000, 1000)]), maps);
    expect(r.flows.find((f) => f.id === '1:1')!.counts.overlap).toBe(1);
    expect(r.flows.find((f) => f.id === '9:1')!.findings).toEqual([]);
  });

  it('lists scope flows with no matching section, ignoring Parked sections and loose screens', () => {
    const d = doc([
      section('L', 'LATEST', [section('1:1', 'Onboarding', [screen('s1', 'Home', [])], 0, 0, 2000, 1000), section('2:1', 'Activate', [screen('s2', 'Activate', [], 0, 1200)], 0, 1200, 2000, 1000)], 0, 0, 3000, 3000),
      section('9:1', 'Parked', [screen('p1', 'Checkout', [], 0, 4000)], 0, 4000),
      screen('loose', 'Search', [], 6000, 0),
    ]);
    const r = checkFlows(d, maps, scope(['onboarding flow', 'LATEST Activate', 'Checkout', 'Search']));
    expect(r.missing).toEqual(['Checkout', 'Search']);
  });
});

describe('flowFixPrompt', () => {
  it('asks for a plan first and lists findings with node ids', () => {
    const r = checkFlows(doc([section('1:1', 'Flow 1', [screen('s1', 'Home', [button('Save', { id: '5:6', interactions: [hover()] })])]), section('2:1', 'Flow 2', [screen('s2', 'Done', [], 0, 3000)], 0, 3000)]), maps);
    const text = flowFixPrompt({ id: 'r', at: 0, fileKey: 'abc', flows: r.flows, unchecked: r.unchecked });
    expect(text).toContain('wait for my approval before you edit anything');
    expect(text).toContain('Flow 1 (section 1:1 https://www.figma.com/design/abc?node-id=1-1):');
    expect(text).toContain('- [no-click] Home: Button "Save" looks clickable but has no click. Fix:');
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
  it('reads scope.json from the chat folder and stores the missing flows', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    await writeFile(path.join(dir, 'scope.json'), JSON.stringify(scope(['Home', 'Checkout'], ['Add a workflow'])));
    const load = async () => ({ document: doc([section('1:1', 'Home', [screen('s1', 'Home', [ok('Add a workflow')])])]), maps });
    const run = await runFlowCheck({ dir, fileKey: 'abc', load });
    expect(run.missing).toEqual(['Checkout']);
    expect(run.flows[0].counts).toEqual({ 'parked-link': 1 });
    expect((await readFlowChecks(dir))[0].missing).toEqual(['Checkout']);
  });
  it('leaves missing out when every scope flow is found, and takes a scope passed in', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    const load = async () => ({ document: doc([section('1:1', 'Home', [screen('s1', 'Home', [])])]), maps });
    const run = await runFlowCheck({ dir, fileKey: 'abc', load, scope: scope(['Home']) });
    expect(run).not.toHaveProperty('missing');
  });
  it('returns no flows for the sample file without calling Figma', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flowcheck-'));
    const run = await runFlowCheck({ dir, fileKey: 'sample', load: async () => { throw new Error('no'); } });
    expect(run.flows).toEqual([]);
  });
});
