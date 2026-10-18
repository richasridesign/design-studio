import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PendingPermission, PendingQuestion } from '../../../shared/protocol';
import { lineDiff, PermissionCard, PlanCard, QuestionCard } from './Pending';

const permission = (toolName: string, input: Record<string, unknown>, extra: Partial<PendingPermission> = {}): PendingPermission =>
  ({ id: 'p1', kind: 'permission', toolName, title: 'Run a shell command', input, canAlwaysAllow: true, ...extra });

const render = (p: PendingPermission, mode = 'default') => renderToStaticMarkup(createElement(PermissionCard, { p, mode, first: true }));

describe('lineDiff', () => {
  it('keeps shared lines and puts removals before additions', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual([[' ', 'a'], ['-', 'b'], ['+', 'B'], [' ', 'c']]);
  });

  it('shows a new file as additions only', () => {
    expect(lineDiff('', 'x\ny')).toEqual([['+', 'x'], ['+', 'y']]);
  });
});

describe('PermissionCard', () => {
  it('shows the command, the three buttons with key hints and the mode hint', () => {
    const out = render(permission('Bash', { command: 'ls -la', description: 'List files' }, { title: 'List files' }));
    expect(out).toContain('<pre class="pd-code">ls -la</pre>');
    expect(out).toContain('Allow<kbd>Y</kbd>');
    expect(out).toContain('Always allow<kbd>A</kbd>');
    expect(out).toContain('Deny<kbd>N</kbd>');
    expect(out).toContain('Default mode asks before edits and commands');
  });

  it('does not repeat the title as the description', () => {
    const out = render(permission('Bash', { command: 'ls -la', description: 'List files' }, { title: 'List files' }));
    expect(out).not.toContain('pd-desc');
    const other = render(permission('Bash', { command: 'ls -la', description: 'Lists everything' }, { title: 'Run a shell command' }));
    expect(other).toContain('<div class="pd-desc">Lists everything</div>');
  });

  it('renders an edit as a line diff', () => {
    const out = render(permission('Edit', { file_path: '/repo/a.ts', old_string: 'x = 1', new_string: 'x = 2' }, { title: 'Edit a.ts' }));
    expect(out).toContain('<div class="pd-path">/repo/a.ts</div>');
    expect(out).toContain('<div class="del">- x = 1</div>');
    expect(out).toContain('<div class="add">+ x = 2</div>');
  });

  it('falls back to key value rows for other tools', () => {
    const out = render(permission('Grep', { pattern: 'todo', path: 'src', empty: '' }, { title: 'Use Grep' }));
    expect(out).toContain('<span class="pd-key">pattern</span>');
    expect(out).toContain('<span class="pd-key">path</span>');
    expect(out).not.toContain('<span class="pd-key">empty</span>');
  });

  it('drops Always allow and the Y hint when confirmation is required', () => {
    const out = render(permission('Bash', { command: 'rm -rf dist' }, { canAlwaysAllow: false, confirmFirst: true }));
    expect(out).not.toContain('Always allow');
    expect(out).not.toContain('<kbd>Y</kbd>');
    expect(out).toContain('Deny<kbd>N</kbd>');
  });
});

describe('PlanCard', () => {
  it('renders the plan as Markdown with Approve and Keep planning', () => {
    const p = permission('ExitPlanMode', { plan: '# Steps\n\n1. one' }, { title: 'Approve the plan to start building' });
    const out = renderToStaticMarkup(createElement(PlanCard, { p, mode: 'plan', first: true }));
    expect(out).toMatch(/<h1[^>]*>Steps<\/h1>/);
    expect(out).toContain('Approve<kbd>Y</kbd>');
    expect(out).toContain('Keep planning<kbd>N</kbd>');
    expect(out).not.toContain('Always allow');
    expect(out).toContain('Plan mode asks before it starts building');
  });
});

describe('QuestionCard', () => {
  const single = { question: 'Which colour?', header: 'Theme', options: [{ label: 'Red', description: 'Warm' }, { label: 'Blue', description: '' }] };
  const multi = { question: 'Pick extras', header: '', multiSelect: true, options: [{ label: 'Tests', description: '' }, { label: 'Docs', description: '' }] };
  const render = (questions: PendingQuestion['questions']) =>
    renderToStaticMarkup(createElement(QuestionCard, { q: { id: 'q1', kind: 'question', questions }, first: true }));

  it('shows the header, a counter and hollow dots for a single choice', () => {
    const out = render([single, multi, single]);
    expect(out).toContain('<span class="pd-label">Theme</span>');
    expect(out).toContain('<span class="pd-count">1 of 3</span>');
    expect(out).toContain('<div class="pd-ask">Which colour?</div>');
    expect(out.match(/class="pd-dot"/g)).toHaveLength(3);
    expect(out).toContain('role="radio"');
    expect(out).toContain('Other…');
    expect(out).not.toContain('Next');
  });

  it('uses mono checks and a Done button for a multi select', () => {
    const out = render([multi]);
    expect(out).toContain('<span class="pd-label">Question</span>');
    expect(out).not.toContain('pd-count');
    expect(out.match(/\[ \]/g)).toHaveLength(3);
    expect(out).toContain('role="checkbox"');
    expect(out).toContain('>Done</button>');
  });
});
