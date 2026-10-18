import { describe, expect, it } from 'vitest';
import { FLOW_RULE_LABEL, FLOW_RULES, flowFixPrompt, flowMatches, namedLike, nameWords } from './flowcheck.js';

describe('nameWords and namedLike', () => {
  it('ignores case, punctuation, accents and extra spaces', () => {
    expect(nameWords('  Button / Add-a-Workflow!  ')).toBe('button add a workflow');
    expect(nameWords('Résumé')).toBe('resume');
    expect(namedLike('Button / Add-a-Workflow', 'Add a workflow')).toBe(true);
    expect(namedLike('ADD A WORKFLOW', 'add a workflow')).toBe(true);
  });
  it('matches whole words only, and never an empty name', () => {
    expect(namedLike('Research notes', 'Search')).toBe(false);
    expect(namedLike('Search field', 'Search')).toBe(true);
    expect(namedLike('Anything', '  ')).toBe(false);
  });
});

describe('flowMatches', () => {
  it('finds every word of the flow in the section name or path, in any order', () => {
    expect(flowMatches('Activate Atlas', 'LATEST Flow 3 · Activate Atlas')).toBe(true);
    expect(flowMatches('Activate Atlas', 'Atlas: activate')).toBe(true);
    expect(flowMatches('Onboarding flow', 'V4 · Onboarding')).toBe(true);
    expect(flowMatches('Connectors', 'Connector setup')).toBe(true);
  });
  it('does not match a section that has only some of the words', () => {
    expect(flowMatches('Activate Atlas', 'Atlas home')).toBe(false);
    expect(flowMatches('Checkout', 'Cart')).toBe(false);
  });
  it('keeps a flow named only with filler words', () => {
    expect(flowMatches('Flow', 'Flow 1')).toBe(true);
    expect(flowMatches('Flow', 'Home')).toBe(false);
  });
});

describe('parked-link rule', () => {
  it('is a rule with a plain label', () => {
    expect(FLOW_RULES).toContain('parked-link');
    expect(FLOW_RULE_LABEL['parked-link']).toBe('Link to parked');
  });
});

describe('flowFixPrompt with missing flows', () => {
  it('names the flows not found in the file', () => {
    const t = flowFixPrompt({ id: 'r', at: 0, fileKey: 'abc', flows: [], unchecked: [], missing: ['Checkout', 'Search'] });
    expect(t).toContain('Not found in the file: Checkout, Search.');
    expect(t).not.toMatch(/—/);
  });
});
