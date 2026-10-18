import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './sidebar.css';
import './connect.css';
import './mobile.css';
import './spend.css';
import './crit.css';
import './buildcheck.css';
import './handoff.css';
import './comments.css';
import './shortcuts.css';
import './versions.css';
import './rules.css';
import { touch } from './touch';

if (touch()) window.addEventListener('focusout', () => window.scrollTo(0, 0));

createRoot(document.getElementById('root')!).render(<App />);
