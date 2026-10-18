import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusReview, takeReviewFocus } from './reviewFocus';

afterEach(() => vi.unstubAllGlobals());

describe('review focus', () => {
  it('hands the focus over once and opens the Review pane', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    focusReview({ runId: 'r1', area: 'color' });
    expect(dispatchEvent.mock.calls.map(([e]) => e.type)).toEqual(['designstudio:review-focus', 'designstudio:command']);
    expect(dispatchEvent.mock.calls[1][0].detail).toEqual({ id: 'page:review' });
    expect(takeReviewFocus()).toEqual({ runId: 'r1', area: 'color' });
    expect(takeReviewFocus()).toBeNull();
  });
});
