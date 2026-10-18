const PRIVATE_V4 = /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/;

export function allowedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
  if (h.endsWith('.ts.net') || h.endsWith('.local') || h.endsWith('.netbird.cloud')) return true;
  const m = PRIVATE_V4.exec(h);
  return !!m && h.split('.').every((p) => Number(p) <= 255);
}

export function allowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return allowedHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function allowedHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return allowedHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
