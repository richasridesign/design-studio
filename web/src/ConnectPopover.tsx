import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import QRCode from 'qrcode';

export function networkLabel(url: string): string {
  const ip = url.replace(/^https?:\/\//, '').split(':')[0];
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return 'Tailscale';
  if (/^(192\.168|10)\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 'Wi-Fi';
  return 'Network';
}

export function ConnectPopover({ onClose }: { onClose: () => void }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [pick, setPick] = useState(0);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/connect?port=${location.port}`)
      .then((r) => r.json())
      .then((d: { urls: string[] }) => setUrls(d.urls))
      .catch((e) => setError(String(e)));
  }, []);

  const url = urls?.[pick];
  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { margin: 2, width: 200, color: { dark: '#000000', light: '#ffffff' } }).then(setQr);
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay connect-overlay" onClick={onClose}>
      <div className="switcher connect" onClick={(e) => e.stopPropagation()}>
        <div className="connect-head">
          <span>Open on phone</span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        {error && <div className="connect-body muted">{error}</div>}
        {urls && urls.length === 0 && <div className="connect-body muted">No network address found.</div>}
        {url && (
          <div className="connect-body">
            {urls!.length > 1 && (
              <div className="connect-tabs">
                {urls!.map((u, i) => (
                  <button key={u} className={i === pick ? 'active' : ''} onClick={() => setPick(i)}>{networkLabel(u)}</button>
                ))}
              </div>
            )}
            {qr && <img className="connect-qr" src={qr} alt={url} />}
            <div className="connect-url">{url}</div>
          </div>
        )}
        <div className="connect-note muted small">
          Scan with the phone camera. Tailscale works from anywhere while the phone is on your tailnet; Wi-Fi needs the
          same network. In Safari, Share then Add to Home Screen opens Design Studio as an app.
        </div>
      </div>
    </div>
  );
}
