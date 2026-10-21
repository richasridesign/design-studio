import { postJson, setUi } from '../store';

// Small helpers the panes share to talk to the composer, the Figma tab and the attach dialog.

export const insertPrompt = (text: string) => window.dispatchEvent(new CustomEvent('designstudio:insert', { detail: text }));
/** Shows and focuses the message box without changing its text. */
export const focusComposer = () => window.dispatchEvent(new Event('designstudio:compose'));
export const attachFigma = () => window.dispatchEvent(new Event('designstudio:attach'));
/** Shows a frame in the Figma tab. An expanded chat collapses first, so the frame is in sight. */
export const showNode = (nodeId: string) => {
  window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'chat:collapse' } }));
  return postJson('/api/figma/focus', { nodeId }).catch(() => {});
};
/** Opens a file of the chat folder in the Files tab, the file itself and not only its folder in the sidebar. */
export const openFileTab = (rel: string) => {
  setUi({ openFile: rel, follow: false });
  window.dispatchEvent(new CustomEvent('designstudio:command', { detail: { id: 'page:code' } }));
};
