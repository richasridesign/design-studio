import { postJson } from '../store';

// Small helpers the panes share to talk to the composer, the Figma tab and the attach dialog.

export const insertPrompt = (text: string) => window.dispatchEvent(new CustomEvent('designstudio:insert', { detail: text }));
/** Shows and focuses the message box without changing its text. */
export const focusComposer = () => window.dispatchEvent(new Event('designstudio:compose'));
export const attachFigma = () => window.dispatchEvent(new Event('designstudio:attach'));
export const showNode = (nodeId: string) => postJson('/api/figma/focus', { nodeId }).catch(() => {});

export const openFigmaTab = () => window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:figma' } }));
