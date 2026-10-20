import { describe, expect, it } from 'vitest';
import { captureReader, type CaptureMsg } from './figmaApp.js';

const rec = (type: number, body: Buffer) => { const h = Buffer.alloc(5); h[0] = type; h.writeUInt32BE(body.length, 1); return Buffer.concat([h, body]); };
const frame = (w: number, h: number, jpeg: Buffer) => { const b = Buffer.alloc(8); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); return rec(2, Buffer.concat([b, jpeg])); };

describe('captureReader', () => {
  it('reads states and frames however the helper output is split', () => {
    const stream = Buffer.concat([rec(1, Buffer.from('{"state":"on"}')), frame(1440, 900, Buffer.from([0xff, 0xd8, 1, 2, 3])), rec(1, Buffer.from('{"state":"nowindow"}'))]);
    for (const step of [1, 3, 7, stream.length]) {
      const got: CaptureMsg[] = [];
      const read = captureReader((m) => got.push(m));
      for (let i = 0; i < stream.length; i += step) read(stream.subarray(i, i + step));
      expect(got).toEqual([
        { kind: 'state', state: 'on', detail: undefined },
        { kind: 'frame', w: 1440, h: 900, jpeg: Buffer.from([0xff, 0xd8, 1, 2, 3]) },
        { kind: 'state', state: 'nowindow', detail: undefined },
      ]);
    }
  });

  it('stops at output it cannot read instead of guessing', () => {
    const got: CaptureMsg[] = [];
    const read = captureReader((m) => got.push(m));
    read(Buffer.from('not a record at all'));
    read(rec(1, Buffer.from('{"state":"on"}')));
    expect(got).toEqual([{ kind: 'state', state: 'error', detail: 'unreadable output from the capture helper' }]);
  });
});
