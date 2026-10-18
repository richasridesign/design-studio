import { describe, expect, it } from 'vitest';
import { allowedHost, allowedOrigin } from './origin.js';

describe('allowedOrigin', () => {
  it('allows a missing origin', () => expect(allowedOrigin(undefined)).toBe(true));

  it('allows local and private hosts', () => {
    for (const o of ['http://localhost:5174', 'http://127.0.0.1:7778', 'http://[::1]:5174', 'http://10.1.2.3:5174', 'http://172.16.0.1', 'http://172.31.255.1', 'http://192.168.1.5:5174', 'http://100.64.0.1:5174', 'http://100.127.9.9', 'https://box.tail1234.ts.net', 'http://mac.local:5174'])
      expect(allowedOrigin(o), o).toBe(true);
  });

  it('rejects other hosts', () => {
    for (const o of ['https://evil.example', 'http://172.32.0.1', 'http://172.15.0.1', 'http://100.63.0.1', 'http://100.128.0.1', 'http://192.169.1.1', 'http://11.0.0.1', 'http://localhost.evil.com', 'http://evil.ts.net.example', 'null', 'not a url', 'http://10.0.0.999'])
      expect(allowedOrigin(o), o).toBe(false);
  });
});

describe('allowedHost', () => {
  it('checks the hostname of a Host header', () => {
    expect(allowedHost('localhost:7778')).toBe(true);
    expect(allowedHost('100.80.1.2:5174')).toBe(true);
    expect(allowedHost('evil.example:7778')).toBe(false);
    expect(allowedHost(undefined)).toBe(false);
  });
});
