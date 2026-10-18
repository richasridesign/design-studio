import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { briefLede, buildReport, esc, markdown, safeId } from './report.js';

let dir = '';
const figma = { key: 'abcdefghij1', name: 'Shop <app>', url: 'https://www.figma.com/design/abcdefghij1' };

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'report-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('buildReport', () => {
  it('renders brief, review and crit and escapes text', async () => {
    await writeFile(path.join(dir, 'plan.md'), '# Plan\n\n- one **bold**\n- <script>alert(1)</script>\n');
    const finding = { id: 'f1', area: 'color', node: '1:2', severity: 'major', rule: 'Bad <script>x</script>', fix: 'Use primary' };
    await writeFile(path.join(dir, 'review.json'), JSON.stringify({ runs: [{ id: 'r', kind: 'review', at: 1, round: 1, preset: 'quick', frames: [], check: [], results: [{ area: 'all', pass: false, summary: 'Needs work', findings: [finding], tokens: 0, costUsd: 0 }], tokens: 0, costUsd: 0 }] }));
    await writeFile(path.join(dir, 'crit.json'), JSON.stringify({ runs: [{ id: 'c', at: 1, frames: [], summary: 'Solid', personas: [{ id: 'new-user', verdict: 'Clear', points: [{ kind: 'concern', text: 'Tiny label' }] }], tokens: 0, costUsd: 0 }] }));
    const html = await buildReport(dir, figma);
    expect(html).toContain('<h2>Brief</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<h2>Review</h2>');
    expect(html).toContain('Use primary');
    expect(html).toContain('<h2>Crit</h2>');
    expect(html).toContain('New user');
    expect(html).toContain('Shop &lt;app&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<h2>Sketches</h2>');
    expect(html).not.toContain('<h2>Copy changes</h2>');
  });

  it('lists house rule results with links to failing frames', async () => {
    const rules = [{ rule: 'One primary <b>', state: 'fail', frames: ['1:2'] }, { rule: 'Sentence case', state: 'pass', frames: [] }];
    await writeFile(path.join(dir, 'review.json'), JSON.stringify({ runs: [{ id: 'r', kind: 'review', at: 1, round: 1, preset: 'quick', frames: ['1:2'], check: [], results: [], rules, tokens: 0, costUsd: 0 }] }));
    const html = await buildReport(dir, figma);
    expect(html).toContain('<h3>House rules <small>1 of 2 passed</small></h3>');
    expect(html).toContain('Failed</span> One primary &lt;b&gt;');
    expect(html).toContain(`href="https://www.figma.com/design/${figma.key}?node-id=1-2"`);
    expect(html).toContain('Passed</span> Sentence case');
  });

  it('escapes quotes and renders markdown lists', () => {
    expect(esc(`<a href="x">'`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;');
    expect(markdown('## Hi\n\ntext `code`\n\n1. a\n2. b')).toContain('<ol>');
  });

  it('accepts only safe ids', () => {
    for (const id of ['a1', '1:2', 'I1;2', 'x-y_z.v2']) expect(safeId(id), id).toBe(true);
    for (const id of ['../x', 'a..b', 'a/b', 'a b', '', 5, null]) expect(safeId(id), String(id)).toBe(false);
  });

  it('lists the decision log, newest first, with reasons escaped', async () => {
    const d = (id: string, name: string) => ({ id, name, rationale: `${name} fits`, items: [] });
    await writeFile(path.join(dir, 'sketch.json'), JSON.stringify({ screens: [
      { id: 'cart', name: 'Cart', chosen: 'a', directions: [d('a', 'List'), d('b', 'Cards')] },
      { id: 'empty', name: 'Empty', chosen: 'b', chosenBy: 'designer', reason: 'Calm <b>', rejected: ['Hints'], at: Date.UTC(2026, 9, 1, 9), directions: [d('a', 'Hints'), d('b', 'Plain')] },
    ] }));
    await writeFile(path.join(dir, 'stages.json'), JSON.stringify({ spec: { at: Date.UTC(2026, 9, 2, 9), note: 'Brief is clear' }, explore: { at: Date.UTC(2026, 9, 3, 9) } }));
    const html = await buildReport(dir, figma);
    const log = html.slice(html.indexOf('<h2>Decision log</h2>'));
    expect(log).toContain('<strong>Stage</strong>: Approved Spec<br>Why: Brief is clear');
    expect(log).toContain('<strong>Empty</strong>: Chose Plain<br>Over: Hints<br>Why: Calm &lt;b&gt;');
    expect(log).toContain('Picked by the designer');
    expect(log).toContain('<strong>Cart</strong>: Chose List<br>Over: Cards<br>Why: List fits<br><small>Picked by Claude</small>');
    expect(log).not.toContain('Approved Explore');
    expect(log.indexOf('Approved Spec')).toBeLessThan(log.indexOf('Chose Plain'));
    expect(log.indexOf('Chose Plain')).toBeLessThan(log.indexOf('Chose List'));
  });

  it('leaves the decision log out when nothing was decided', async () => {
    await writeFile(path.join(dir, 'stages.json'), JSON.stringify({ spec: { at: 1 } }));
    expect(await buildReport(dir, figma)).not.toContain('Decision log');
  });

  it('adds research and scope with the parked notes, escaped', async () => {
    await writeFile(path.join(dir, 'research.md'), '## Looked at\n- Oda <hearts>\n![Oda cart](research/oda.png)');
    await writeFile(path.join(dir, 'scope.json'), JSON.stringify({ flows: ['Checkout'], parked: [{ name: 'Saved <lists>', why: 'Not in the MVP', restore: 'Add the heart back', at: Date.UTC(2026, 9, 1) }] }));
    const html = await buildReport(dir, figma);
    expect(html).toContain('<h2>Research</h2>');
    expect(html).toContain('<li>Oda &lt;hearts&gt;</li>');
    expect(html).toContain('(Screenshot: Oda cart)');
    expect(html).toContain('<p>Flows in scope: Checkout</p>');
    expect(html).toContain('<strong>Saved &lt;lists&gt;</strong>, parked 1 Oct 2026<br>Why: Not in the MVP<br>To restore: Add the heart back');
  });

  it('leaves research and scope out when there are none', async () => {
    const html = await buildReport(dir, figma);
    expect(html).not.toContain('<h2>Research</h2>');
    expect(html).not.toContain('<h2>Scope</h2>');
  });

  it('opens with a summary: goal, Figma link, stage strip and open issue counts', async () => {
    await writeFile(path.join(dir, 'plan.md'), '# Shop\n\n## Goal\nLet people <check out> fast.\n\n## Users\n- Parents');
    await writeFile(path.join(dir, 'stages.json'), JSON.stringify({ spec: { at: 1 }, explore: { at: 2 } }));
    await writeFile(path.join(dir, 'design.json'), JSON.stringify({ frames: [{ screen: 'Cart', state: 'Default', nodeId: '1:2' }, { screen: 'Cart', state: 'Error', nodeId: '1:3' }] }));
    const f = (id: string, severity: string) => ({ id, area: 'color', node: '1:2', severity, rule: 'r', fix: 'x' });
    await writeFile(path.join(dir, 'review.json'), JSON.stringify({ runs: [{ id: 'r', kind: 'review', at: 1, round: 1, preset: 'quick', frames: ['1:2'], check: [f('a', 'blocking'), f('b', 'minor')], results: [{ area: 'color', pass: false, summary: 's', findings: [f('c', 'major'), f('d', 'major')], tokens: 0, costUsd: 0 }], rules: [{ rule: 'One primary', state: 'fail', frames: [] }], tokens: 0, costUsd: 0 }] }));
    await writeFile(path.join(dir, 'flowcheck.json'), JSON.stringify({ runs: [{ id: 'f', at: 1, fileKey: figma.key, unchecked: [], flows: [
      { id: '9:1', name: 'Checkout', path: [], page: 'P', screens: 3, state: 'fail', counts: { 'no-hover': 2 }, unchecked: [], findings: [], more: 0 },
      { id: '9:2', name: 'Empty', path: [], page: 'P', screens: 1, state: 'pass', counts: {}, unchecked: [], findings: [], more: 0 },
    ] }] }));
    const html = await buildReport(dir, figma);
    const top = html.slice(html.indexOf('<section id="summary"'), html.indexOf('<section id="brief"'));
    expect(top).toContain('<p class="lede">Let people &lt;check out&gt; fast.</p>');
    expect(top).toContain(`<a class="file" href="${figma.url}">Open in Figma</a>`);
    expect(top).toContain('<dt>Frames:</dt><dd>2 frames, 1 screen</dd>');
    expect(top).toContain('<dt>Stage:</dt><dd>Decide</dd>');
    expect(top).toContain('<span class="st pass">Explore</span><small>Approved</small>');
    expect(top).toContain('<span class="st current">Decide</span><small>Current</small>');
    expect(top).toContain('<span class="st none">Ship</span><small>Later</small>');
    expect(top).toContain('<span class="num">1</span><span class="st blocking">Blocking</span>');
    expect(top).toContain('<span class="num">2</span><span class="st major">Major</span>');
    expect(top).toContain('<span class="num">1</span><span class="st minor">Minor</span>');
    expect(top).toContain('House rules:</span> 0 of 1 passed');
    expect(top).toContain('Prototype check:</span> 2 issues in 1 of 2 flows');
    expect(html).toContain('<nav class="toc" aria-label="Contents">');
    expect(html).not.toContain('<h3>Shop</h3>');
    // "Cart / Default" already names the state.
    expect(html).not.toContain('State: Default');
  });

  it('says the review has not run instead of showing zero issues', async () => {
    await writeFile(path.join(dir, 'design.json'), JSON.stringify({ frames: [{ screen: 'Cart', state: 'Default', nodeId: '1:2', name: 'Cart <main>' }] }));
    const html = await buildReport(dir, figma);
    expect(html).toContain('Review:</span> Not run yet');
    expect(html).toContain('Prototype check:</span> Not run yet');
    expect(html).not.toContain('class="tiles"');
    expect(html).not.toContain('<h2>Review</h2>');
    // No screenshot: the frame is a linked row, not an empty card.
    const design = html.slice(html.indexOf('<section id="design"'));
    expect(design).not.toContain('<figure');
    expect(design).toContain(`<li><a href="https://www.figma.com/design/${figma.key}?node-id=1-2">Cart &lt;main&gt;</a>`);
    expect(design).toContain('<small>State: Default</small>');
  });

  it('does not call a partly read prototype check a pass', async () => {
    await writeFile(path.join(dir, 'design.json'), JSON.stringify({ frames: [{ screen: 'Cart', state: 'Default', nodeId: '1:2' }] }));
    await writeFile(path.join(dir, 'flowcheck.json'), JSON.stringify({ runs: [{ id: 'f', at: 1, fileKey: figma.key, unchecked: [], truncated: true, flows: [
      { id: '9:1', name: 'Checkout', path: [], page: 'P', screens: 3, state: 'pass', counts: {}, unchecked: [], findings: [], more: 0 },
    ] }] }));
    const html = await buildReport(dir, figma);
    expect(html).toContain('<span class="st none">Prototype check:</span> No issues found, some flows not checked');
    expect(html).toContain('some flows were not checked.</p>');
    expect(html).not.toContain('The flow passed');
  });

  it('lists frames from the review run when an older chat has no design.json', async () => {
    await writeFile(path.join(dir, 'review.json'), JSON.stringify({ runs: [{ id: 'r', kind: 'review', at: 1, round: 1, preset: 'quick', frames: ['12:3', '12:4'], check: [], results: [], tokens: 0, costUsd: 0 }] }));
    await writeFile(path.join(dir, 'crit.json'), JSON.stringify({ runs: [{ id: 'c', at: 1, frames: [], summary: '', personas: [{ id: 'product', verdict: '', points: [] }], tokens: 0, costUsd: 0 }] }));
    const html = await buildReport(dir, figma);
    expect(html).toContain('<dt>Frames:</dt><dd>2 frames</dd>');
    expect(html).toContain('<h2>Design</h2>');
    expect(html).toContain(`<a href="https://www.figma.com/design/${figma.key}?node-id=12-4">Layer 12:4</a>`);
    // A persona with nothing to say leaves no empty heading, and no Crit section at all.
    expect(html).not.toContain('<h2>Crit</h2>');
  });

  it('shows one plain line and no headings for an empty chat', async () => {
    const html = await buildReport(dir, null);
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('<nav');
    expect(html).toContain('Nothing to hand off yet.');
  });

  it('keeps a lone section without a table of contents or empty issue block', async () => {
    await writeFile(path.join(dir, 'plan.md'), 'Just a line');
    const html = await buildReport(dir, figma);
    expect(html).not.toContain('<nav');
    expect(html).not.toContain('Open issues');
    expect(html).not.toContain('<dt>Stage:</dt>');
  });

  it('drops a title heading and starts headings at h3', () => {
    expect(markdown('# Research\n\n## Looked at\n- a', { dropTitle: true })).toBe('<h3>Looked at</h3>\n<ul>\n<li>a</li>\n</ul>');
    expect(markdown('### Deep\ntext')).toBe('<h3>Deep</h3>\n<p>text</p>');
    expect(markdown('# One\n# Two', { dropTitle: true })).toContain('<h3>One</h3>');
  });

  it('takes the lede from the Goal section, or the first paragraph', () => {
    expect(briefLede('# T\n\n## Users\n- a\n\n## Goal\nShip **fast**\nand calm.\n\n## Next\nNo')).toBe('Ship fast and calm.');
    expect(briefLede('# T\n\nFirst para.\n\n## Goal')).toBe('First para.');
    expect(briefLede('x'.repeat(400))).toHaveLength(280);
    expect(briefLede('- only a list')).toBe('');
  });

  it('inlines sketches as data images, not markup', async () => {
    await mkdir(path.join(dir, 'sketches'));
    await writeFile(path.join(dir, 'sketches', 's1--d1.svg'), '<svg><script>alert(1)</script></svg>');
    await writeFile(path.join(dir, 'sketch.json'), JSON.stringify({ screens: [{ id: 's1', name: 'Home', directions: [{ id: 'd1', name: 'A', rationale: 'r', items: [] }] }] }));
    const html = await buildReport(dir, figma);
    expect(html).toContain('src="data:image/svg+xml;base64,');
    expect(html).not.toContain('<script>alert');
  });
});
