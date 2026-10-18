import { describe, expect, it } from 'vitest';
import { pickFigmaTabs } from './chrome.js';

describe('pickFigmaTabs', () => {
  it('lists Figma file tabs newest first, one per file, without the Figma suffix', () => {
    const tabs = [
      { title: 'Cart – Figma', url: 'https://www.figma.com/design/AbC1234567xyz/Cart?node-id=1-2', at: 1 },
      { title: 'Cart – Figma', url: 'https://www.figma.com/design/AbC1234567xyz/Cart', at: 3 },
      { title: 'Inbox', url: 'https://mail.google.com/', at: 4 },
      { title: 'Board – FigJam', url: 'https://www.figma.com/board/ZzZ1234567xyz/Board', at: 5 },
      { title: 'Checkout - Figma', url: 'https://www.figma.com/file/QqQ1234567xyz/Checkout', at: 2 },
    ];
    expect(pickFigmaTabs(tabs)).toEqual([
      { title: 'Cart', url: 'https://www.figma.com/design/AbC1234567xyz/Cart' },
      { title: 'Checkout', url: 'https://www.figma.com/file/QqQ1234567xyz/Checkout' },
    ]);
  });
});
