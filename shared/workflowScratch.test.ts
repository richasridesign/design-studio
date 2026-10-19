import { describe, expect, it } from 'vitest';
import { defaultState, nextState, stepCard, stepPrompt, type WorkflowEvidence, type WorkflowState } from './workflow.js';

// From scratch: the cards and prompts of Explore, Pick, High fidelity, Design system and Keep iterating.

const ev = (over: Partial<WorkflowEvidence> = {}): WorkflowEvidence => ({
  flow: { n: 3, name: 'Connectors' }, iteration: { id: '1.19', state: 'working' }, screens: 0, source: { kind: 'none' } as never,
  cost: 'about $0.40', depth: 'Full', review: null, reviewing: false, system: null, ...over,
});
const options = [{ id: 'A' as const, name: 'Cards', node: '9:1' }, { id: 'B' as const, name: 'Table', node: '9:2' }, { id: 'C' as const, name: 'Wizard', node: '9:3' }];
const explored = (): WorkflowState => nextState(defaultState(false, 1), { type: 'options', options, at: 2 });
const picked = (): WorkflowState => nextState(explored(), { type: 'pick', id: 'B', why: 'Admins compare many connectors at once', at: 3 });

describe('From scratch cards', () => {
  it('Explore: one primary, and after options a quiet Explore again beside Pick', () => {
    expect(stepCard(defaultState(false), ev())).toEqual({ line: 'Claude makes 2 or 3 low fidelity options in Figma, inside this flow.', button: { label: 'Explore options', action: 'explore', primary: true } });
    const back = nextState(explored(), { type: 'step', step: 'explore', at: 3 });
    expect(stepCard(back, ev())).toEqual({ line: '3 options in Figma. Explore again for new ones, or pick one.', button: { label: 'Explore options', action: 'explore', primary: false }, link: { label: 'Pick an option', action: 'pick' } });
  });

  it('Pick: the radio card once options exist, else back to Explore', () => {
    expect(stepCard(explored(), ev())).toEqual({ line: 'Pick the option to take to high fidelity.', pick: true });
    const early = nextState(defaultState(false), { type: 'step', step: 'pick', at: 2 });
    expect(stepCard(early, ev())).toMatchObject({ line: 'No options to pick from yet. Claude makes them in Explore.', button: { action: 'explore', primary: true } });
  });

  it('High fidelity names the pick; done points at the design system', () => {
    expect(stepCard(picked(), ev())).toEqual({ line: 'Builds Option B: Table with every state, wired.', button: { label: 'Build it', action: 'build', primary: true } });
    const none = nextState(defaultState(false), { type: 'step', step: 'hifi', at: 2 });
    expect(stepCard(none, ev())).toMatchObject({ line: 'Builds the picked option with every state, wired.', link: { action: 'pick' } });
    const built = nextState(nextState(picked(), { type: 'done', step: 'hifi', at: 4 }), { type: 'step', step: 'hifi', at: 5 });
    expect(stepCard(built, ev())).toMatchObject({ line: 'Option B: Table is built in high fidelity.', button: { action: 'system' } });
  });

  it('Design system: make one, or extend the one the file has, with Skip either way', () => {
    const s = nextState(picked(), { type: 'done', step: 'hifi', at: 4 });
    expect(s.step).toBe('system');
    expect(stepCard(s, ev())).toEqual({ line: "Turns the screens' parts into variables, text styles and components.", button: { label: 'Make the design system', action: 'system', primary: true }, link: { label: 'Skip', action: 'skip-system' } });
    expect(stepCard(s, ev({ system: { components: 24 } }))).toMatchObject({ line: 'This file has a design system (24 components). Adds only what the new screens need, as new variants.', button: { label: 'Extend the design system' } });
  });

  it('Keep iterating switches to Review and update; a plan card on screen makes every button Secondary', () => {
    const s = nextState(nextState(picked(), { type: 'done', step: 'hifi', at: 4 }), { type: 'skip', step: 'system', at: 5 });
    expect(s.step).toBe('iterate');
    expect(stepCard(s, ev())).toEqual({ line: 'From scratch is done for Connectors. Keep iterating with Review and update.', button: { label: 'Switch to Review and update', action: 'switch-review-update', primary: true } });
    expect(stepCard(s, ev(), true).button?.primary).toBe(false);
    const back = nextState(s, { type: 'switch', workflow: 'review-update', at: 6 });
    expect([back.workflow, back.step]).toEqual(['review-update', 'review']);
  });
});

describe('From scratch prompts', () => {
  it('Explore asks for DS.option subsections, stickies on the first screen, and set_status options', () => {
    const p = stepPrompt('explore', { n: 3, name: 'Connectors' }, '1.19');
    expect(p).toContain('DS.option(flowSubsection, { id: "A"');
    expect(p).toContain('"V1.19 · Flow 3 · Option A: <name>"');
    expect(p).toContain('set_status options from DS.options(flowSubsection)');
    expect(p).toContain('set_status picked');
    expect(p).not.toMatch(/—/);
  });

  it('High fidelity quotes the pick, the options it beat and her reason', () => {
    const p = stepPrompt('hifi', { n: 3, name: 'Connectors' }, '1.19', picked());
    expect(p.startsWith('The designer picked Option B: Table over A and C. Why: Admins compare many connectors at once. Build Option B')).toBe(true);
    expect(p).toContain('stepDone "hifi"');
  });
});
