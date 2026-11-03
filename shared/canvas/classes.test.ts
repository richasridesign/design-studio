import { describe, expect, it } from 'vitest';
import { dimOf, keyword, layoutOf, readTokens, setClass, setDim, setKeyword, setLayout, styleClasses } from './index';

const tokens = readTokens('@theme { --color-text-muted: #807F81; --color-line: #E6E5E6; --text-body-card: 12px; --text-body-card--line-height: 16px; }');

describe('class tokens', () => {
  it('tells sizes, colours and other text classes apart', () => {
    expect(styleClasses('px-4 text-sm text-text-muted text-left hover:bg-line w-[72px] border-t border-line', tokens).map((c) => `${c.label}:${c.value}`))
      .toEqual(['Padding x:4', 'Text size:sm', 'Text colour:text-muted', 'Border colour:line']);
    expect(tokens.text.map((t) => t.name)).toEqual(['body-card']);
  });

  it('rewrites only the matching plain class and keeps the rest as written', () => {
    const c = 'flex  px-4 text-sm text-text-muted hover:px-6';
    expect(setClass(c, 'px', 'space', '6', tokens)).toBe('flex  px-6 text-sm text-text-muted hover:px-6');
    expect(setClass(c, 'text', 'color', 'line', tokens)).toBe('flex  px-4 text-sm text-line hover:px-6');
    expect(setClass(c, 'text', 'size', null, tokens)).toBe('flex  px-4 text-text-muted hover:px-6');
    expect(setClass('px-4 flex', 'px', 'space', null, tokens)).toBe('flex');
    expect(setClass('flex', 'gap', 'space', '2', tokens)).toBe('flex gap-2');
    expect(setClass('', 'gap', 'space', '2', tokens)).toBe('gap-2');
  });

  it('switches layout, keywords and sizes without touching hover or breakpoint classes', () => {
    const c = 'flex flex-col gap-2 md:flex-row items-center';
    expect(layoutOf(c)).toBe('column');
    expect(setLayout(c, 'row')).toBe('flex gap-2 md:flex-row items-center');
    expect(setLayout(c, 'grid')).toBe('grid gap-2 md:flex-row items-center');
    expect(setLayout('p-4', 'column')).toBe('p-4 flex flex-col');
    expect(setLayout(c, 'block')).toBe('gap-2 md:flex-row items-center');
    expect(keyword(c, 'align')).toBe('items-center');
    expect(setKeyword(c, 'align', 'items-end')).toBe('flex flex-col gap-2 md:flex-row items-end');
    expect(setKeyword('border border-line', 'border', '')).toBe('border-line');
    expect(dimOf('w-28 h-[33px]', 'w')).toEqual({ mode: 'fixed', px: 112 });
    expect(dimOf('w-28 h-[33px]', 'h')).toEqual({ mode: 'fixed', px: 33 });
    expect(setDim('w-28 p-2', 'w', { mode: 'fill' })).toBe('w-full p-2');
    expect(setDim('p-2', 'h', { mode: 'fixed', px: 30 })).toBe('p-2 h-[30px]');
    expect(setDim('w-full', 'w', { mode: 'auto' })).toBe('');
  });
});
