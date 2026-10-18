import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './Chat';

const url = 'https://www.figma.com/design/AbC123def456/App?node-id=12-3';

describe('renderMarkdown', () => {
  it('shows a raw frame link as a chip with the frame name', () => {
    const html = renderMarkdown(`Updated ${url} for you`, (id) => (id === '12:3' ? 'Cart' : null));
    expect(html).toContain('class="frame-chip" data-node="12:3"');
    expect(html).toContain('>Cart</a>');
  });

  it('falls back to the node id', () => {
    expect(renderMarkdown(url)).toContain('>12:3</a>');
  });

  it('keeps custom link text and tags the node', () => {
    const html = renderMarkdown(`[the cart](${url})`);
    expect(html).toContain('data-node="12:3"');
    expect(html).toContain('>the cart</a>');
    expect(html).not.toContain('frame-chip');
  });

  it('leaves other links alone', () => {
    expect(renderMarkdown('[docs](https://example.com)')).not.toContain('data-node');
  });
});
