import { describe, expect, it } from 'vitest';
import { accept, figmaLinkIn, nextMode, buildHistory, contextPercent, filesEdited, ghostFor, rankCommands, rankFiles, rankFrames, recentFirst, recentFrameIds, recipeSlug, remember, triggerAt, withRecipes } from './Composer';
import { RECIPES, toRecipe } from '../../../shared/recipes';
import type { ChatEvent } from '../../../shared/protocol';

let n = 0;
const user = (text: string): ChatEvent => ({ id: `u${++n}`, kind: 'user', text, at: n });
const tool = (name: string, input: Record<string, unknown>): ChatEvent => ({ id: `t${++n}`, kind: 'tool_use', name, input, summary: name, at: n });

describe('triggerAt', () => {
  it('finds a slash command at the start of a word', () => {
    expect(triggerAt('/', 1)).toEqual({ kind: 'command', start: 0, query: '' });
    expect(triggerAt('/comp', 5)).toEqual({ kind: 'command', start: 0, query: 'comp' });
    expect(triggerAt('run /co', 7)).toEqual({ kind: 'command', start: 4, query: 'co' });
  });

  it('finds a file mention and keeps the slashes in the query', () => {
    expect(triggerAt('fix @src/store.ts', 17)).toEqual({ kind: 'file', start: 4, query: 'src/store.ts' });
  });

  it('finds a frame mention only after whitespace', () => {
    expect(triggerAt('#he', 3)).toEqual({ kind: 'frame', start: 0, query: 'he' });
    expect(triggerAt('a#b', 3)).toBeNull();
  });

  it('looks at the word under the caret only', () => {
    expect(triggerAt('/compact now', 12)).toBeNull();
    expect(triggerAt('/compact now', 5)).toEqual({ kind: 'command', start: 0, query: 'comp' });
    expect(triggerAt('a/b', 3)).toBeNull();
    expect(triggerAt('mail@me', 7)).toBeNull();
  });

  it('treats a leading bang as shell mode', () => {
    expect(triggerAt('!ls -la', 7)).toEqual({ kind: 'shell' });
    expect(triggerAt('say hi!', 7)).toBeNull();
  });
});

describe('rankCommands', () => {
  const cmds = [{ name: 'add-dir' }, { name: 'compact' }, { name: 'config' }, { name: 'cost' }, { name: 'doctor' }];
  it('puts prefix matches first and marks the matched characters', () => {
    const r = rankCommands(cmds, 'co');
    expect(r.slice(0, 3).map((x) => x.item.name).sort()).toEqual(['compact', 'config', 'cost']);
    expect(r[3]).toMatchObject({ item: { name: 'doctor' }, hits: [2, 4] });
    expect(r[0].hits).toEqual([0, 1]);
  });

  it('shows everything for an empty query, capped at the row limit', () => {
    expect(rankCommands(cmds, '')).toHaveLength(5);
    expect(rankCommands(cmds, '', 2)).toHaveLength(2);
  });

  it('drops commands that do not match', () => {
    expect(rankCommands(cmds, 'zzz')).toEqual([]);
  });
});

describe('rankFiles', () => {
  it('favours the file name over the folder', () => {
    const r = rankFiles(['web/src/store.ts', 'store/web.ts', 'docs/notes.md'], 'web');
    expect(r.map((x) => x.item)).toEqual(['store/web.ts', 'web/src/store.ts']);
  });
});

describe('rankFrames', () => {
  const frames = [{ id: '1:2', name: 'Home', page: 'Web' }, { id: '1:3', name: 'Checkout', page: 'Web' }, { id: '1:4', name: 'Cart', page: 'App' }];
  it('ranks by frame name', () => {
    expect(rankFrames(frames, 'ca').map((x) => x.item.id)).toEqual(['1:4']);
    expect(rankFrames(frames, 'ho')[0].item.name).toBe('Home');
  });

  it('returns nothing without a match', () => {
    expect(rankFrames(frames, 'zzz')).toEqual([]);
  });
});

describe('accept', () => {
  it('replaces the token under the caret and adds a space', () => {
    expect(accept('/comp', 0, 5, '/compact')).toEqual({ text: '/compact ', caret: 9 });
    expect(accept('fix @sto please', 4, 8, '@src/store.ts')).toEqual({ text: 'fix @src/store.ts  please', caret: 18 });
  });
});

describe('buildHistory', () => {
  it('lists this chat newest first, then stored prompts, without repeats or blanks', () => {
    const h = buildHistory([user('first'), user('  '), user('second')], ['old', 'first', 'other']);
    expect(h).toEqual(['second', 'first', 'other', 'old']);
  });
});

describe('ghostFor', () => {
  const history = ['run the tests', 'run the linter', 'ru'];
  it('completes from the most recent matching prompt once three characters are typed', () => {
    expect(ghostFor('run', history)).toBe(' the tests');
    expect(ghostFor('run the l', history)).toBe('inter');
  });

  it('stays quiet for short or complete text', () => {
    expect(ghostFor('ru', history)).toBe('');
    expect(ghostFor('run the tests', history)).toBe('');
    expect(ghostFor('nothing', history)).toBe('');
  });
});

describe('remember', () => {
  it('moves a repeated prompt to the end and keeps the last 50', () => {
    expect(remember('a', ['a', 'b'])).toEqual(['b', 'a']);
    const many = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const r = remember('new', many);
    expect(r).toHaveLength(50);
    expect(r[0]).toBe('p1');
    expect(r.at(-1)).toBe('new');
  });
});

describe('filesEdited', () => {
  it('counts distinct paths across the edit tools only', () => {
    const events = [
      tool('Edit', { file_path: '/a.ts' }),
      tool('Write', { file_path: '/b.ts' }),
      tool('MultiEdit', { file_path: '/a.ts' }),
      tool('Read', { file_path: '/c.ts' }),
      tool('Edit', {}),
      user('ok'),
    ];
    expect(filesEdited(events)).toBe(2);
    expect(filesEdited([])).toBe(0);
  });
});

describe('contextPercent', () => {
  it('measures against the compaction threshold', () => {
    expect(contextPercent(null)).toBeNull();
    expect(contextPercent(100_000)).toBe(50);
    expect(contextPercent(287_000)).toBe(100);
  });
});

describe('nextMode', () => {
  it('cycles chat, design, review, chat', () => {
    expect(nextMode('chat')).toBe('design');
    expect(nextMode('design')).toBe('review');
    expect(nextMode('review')).toBe('chat');
  });
});

describe('figmaLinkIn', () => {
  it('finds a design, file or proto link and its key', () => {
    expect(figmaLinkIn('look at https://www.figma.com/design/AbC1234567/Checkout?node-id=1-2 please')).toEqual({ url: 'https://www.figma.com/design/AbC1234567/Checkout?node-id=1-2', key: 'AbC1234567', name: 'Checkout' });
    expect(figmaLinkIn('https://www.figma.com/design/AbC1234567/Grocery-Cart')?.name).toBe('Grocery Cart');
    expect(figmaLinkIn('https://www.figma.com/design/AbC1234567')?.name).toBe('this Figma file');
    expect(figmaLinkIn('https://figma.com/file/AbC1234567')?.key).toBe('AbC1234567');
    expect(figmaLinkIn('(https://www.figma.com/proto/AbC1234567/x).')?.url).toBe('https://www.figma.com/proto/AbC1234567/x');
  });

  it('ignores other text and links', () => {
    expect(figmaLinkIn('make a card')).toBeNull();
    expect(figmaLinkIn('https://example.com/design/AbC1234567')).toBeNull();
    expect(figmaLinkIn('https://www.figma.com/community/file/123')).toBeNull();
  });
});

describe('withRecipes', () => {
  const server = [{ name: 'design', description: 'Plan' }, { name: 'crit', description: 'Server crit' }, { name: 'copy', description: 'Server copy' }, { name: 'audit', description: 'Audit' }];
  const names = (l: { name: string }[]) => l.map((c) => c.name);

  it('lists the six recipes and keeps one entry for names a server command shares', () => {
    const list = withRecipes(server, RECIPES, []);
    expect(names(list)).toEqual(['brief', 'states', 'responsive', 'copy', 'copy tone:neutral', 'copy tone:formal', 'crit', 'handoff', 'design', 'audit']);
    expect(list.find((c) => c.name === 'crit')).toMatchObject({ description: RECIPES.find((r) => r.id === 'crit')!.blurb, recipe: { id: 'crit' } });
  });

  it('adds a row per other tone after a recipe with a tone', () => {
    const row = withRecipes(server, RECIPES, []).find((c) => c.name === 'copy tone:formal');
    expect(row?.recipe?.prompt).toBe('/copy tone:formal {frames}');
    expect(row?.description).toBe('Copy pass in a formal tone');
  });

  it('adds custom recipes under the slug of the title', () => {
    const custom = [toRecipe({ id: 'c1', title: 'Hero Check!', blurb: '', prompt: 'Check {frames}', group: 'make' })];
    const list = withRecipes(server, RECIPES, custom);
    expect(list.find((c) => c.name === 'hero-check')).toMatchObject({ description: 'Hero Check!', recipe: { id: 'c1' } });
  });

  it('skips custom recipes that repeat a name or have no slug', () => {
    const custom = [
      toRecipe({ id: 'c1', title: 'Brief', blurb: 'x', prompt: 'x', group: 'make' }),
      toRecipe({ id: 'c2', title: '!!!', blurb: 'x', prompt: 'x', group: 'make' }),
    ];
    expect(names(withRecipes([], RECIPES, custom))).toEqual(names(withRecipes([], RECIPES, [])));
  });

  it('ranks recipes by query', () => {
    const r = rankCommands(withRecipes(server, RECIPES, []), 'resp');
    expect(r[0].item.name).toBe('responsive');
  });
});

describe('recipeSlug', () => {
  it('hyphenates and trims', () => {
    expect(recipeSlug('  My  Recipe: v2 ')).toBe('my-recipe-v2');
  });
});

describe('recent frames', () => {
  const use = (name: string, input: Record<string, unknown>, id: string) => ({ id, kind: 'tool_use', name, input, summary: '', at: 0 }) as ChatEvent;
  it('collects node ids from Figma tools, newest first', () => {
    const events = [use('mcp__figma__use_figma', { code: 'node 1:2' }, 'a'), use('Bash', { command: 'echo 9:9' }, 'b'), use('mcp__agentview__set_status', { nodes: ['3:4', '1:2'] }, 'c')];
    expect(recentFrameIds(events)).toEqual(['3:4', '1:2']);
  });
  it('puts recent frames first and keeps the rest in order', () => {
    const f = (id: string) => ({ id, name: id, page: 'P' });
    expect(recentFirst([f('1:1'), f('2:2'), f('3:3')], ['3:3', '9:9']).map((x) => x.id)).toEqual(['3:3', '1:1', '2:2']);
  });
});
