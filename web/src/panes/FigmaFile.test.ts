import { describe, expect, it } from 'vitest';
import { frameLabel, shotPath } from './FigmaFile';

describe('Figma tab frames', () => {
  it('names a frame by its name, else screen and state', () => {
    expect(frameLabel({ screen: 'cart', state: 'empty', nodeId: '1:2', name: 'Cart / Empty' })).toBe('Cart / Empty');
    expect(frameLabel({ screen: 'cart', state: 'empty', nodeId: '1:2' })).toBe('cart / empty');
    expect(frameLabel({ screen: '', state: '', nodeId: '1:2' })).toBe('1:2');
  });
  it('reads the review screenshot saved for the frame', () => {
    expect(shotPath('12:3')).toBe('/api/chat-file/review/shots/12-3.png');
    expect(shotPath('I12:3;4:5')).toBe('/api/chat-file/review/shots/I12-3-4-5.png');
  });
});
