// The app's status marks come from the same map as the handoff report (shared/marks.ts), so a shape means one thing everywhere.
import { markCss } from '../../shared/marks';

const ID = 'designstudio-marks';
if (typeof document !== 'undefined' && !document.getElementById(ID)) {
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = `.mk { display: inline-flex; align-items: center; gap: 8px; }\n${markCss('mk', { error: 'var(--err)', warn: 'var(--warn)', ok: 'var(--ok)', muted: 'var(--fg-muted)', ink: 'var(--fg)' })}`;
  document.head.append(style);
}
