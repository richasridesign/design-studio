import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { screens } from './screens';
import { usePath } from './lib/router';

function App() {
  const path = usePath();
  const screen = screens.find((s) => s.route === path) ?? screens[0];
  const Screen = screen.component;
  return <Screen />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
