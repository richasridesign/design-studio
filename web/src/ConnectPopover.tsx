import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { IconButton } from './Tip';
import { useDialogFocus } from './useDialog';
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

  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(true, box, onClose);

  // Sits 4px under the Open on phone button. Opened from the command palette with the button hidden, it sits top right.
  const [at, setAt] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    const place = () => {
      const r = document.querySelector('.phone-btn')?.getBoundingClientRect();
      setAt(r && r.width > 0 ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : { top: 52, right: 8 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  return (
    <div className="overlay connect-overlay" onClick={onClose}>
      <div ref={box} className="switcher connect" role="dialog" aria-labelledby={titleId} style={at} onClick={(e) => e.stopPropagation()}>
        <div className="connect-head">
          <h2 id={titleId}>Open on phone</h2>
          <span className="spacer" />
          <IconButton label="Close" onClick={onClose}><Icon name="close" /></IconButton>
        </div>
        {error && <div className="connect-body muted">{error}</div>}
        {urls && urls.length === 0 && <div className="connect-body muted">No network address found.</div>}
        {url && (
          <div className="connect-body">
            {urls!.length > 1 && (
              <div className="connect-tabs">
                {urls!.map((u, i) => (
                  <button key={u} className={i === pick ? 'active' : ''} aria-pressed={i === pick} onClick={() => setPick(i)}>{networkLabel(u)}</button>
                ))}
              </div>
            )}
            {qr && <img className="connect-qr" src={qr} alt={url} />}
            <div className="connect-url">{url}</div>
          </div>
        )}
        <div className="connect-note muted small">
          Scan with your phone camera. Your phone needs the same Wi-Fi as this Mac, or Tailscale on both when you are
          away. In Safari, tap Share, then Add to Home Screen to keep Design Studio as an app.
        </div>
      </div>
    </div>
  );
}
