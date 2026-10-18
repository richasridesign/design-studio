import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from './ErrorBoundary';

describe('ErrorBoundary', () => {
  it('stores a render error in state', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('boom'))).toEqual({ error: expect.any(Error) });
  });

  it('renders children when there is no error', () => {
    expect(renderToStaticMarkup(<ErrorBoundary label="panel"><i>ok</i></ErrorBoundary>)).toBe('<i>ok</i>');
  });

  it('renders the error panel for a stored error', () => {
    const b = new ErrorBoundary({ label: 'chat', children: null });
    b.state = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
    const html = renderToStaticMarkup(b.render() as ReactElement);
    expect(html).toContain('This chat hit an error');
    expect(html).toContain('boom');
    expect(html).toContain('Reload chat');
  });
});
