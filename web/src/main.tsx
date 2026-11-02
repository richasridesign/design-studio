import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/styles.css';
import './styles/sidebar.css';
import './styles/connect.css';
import './styles/mobile.css';
import './styles/spend.css';
import './styles/crit.css';
import './styles/buildcheck.css';
import './styles/handoff.css';
import './styles/shortcuts.css';
import './styles/versions.css';
import './styles/rules.css';
import { touch } from './touch';

if (touch()) window.addEventListener('focusout', () => window.scrollTo(0, 0));

createRoot(document.getElementById('root')!).render(<App />);
