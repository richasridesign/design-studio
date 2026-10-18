import { describe, expect, it } from 'vitest';
import { networkLabel } from './ConnectPopover';

describe('networkLabel', () => {
  it('names Tailscale, Wi-Fi and other addresses', () => {
    expect(networkLabel('http://100.64.0.1:5174')).toBe('Tailscale');
    expect(networkLabel('http://192.168.1.5:5174')).toBe('Wi-Fi');
    expect(networkLabel('http://10.0.0.4:5174')).toBe('Wi-Fi');
    expect(networkLabel('http://172.20.1.2:5174')).toBe('Wi-Fi');
    expect(networkLabel('http://8.8.8.8:5174')).toBe('Network');
  });
});
