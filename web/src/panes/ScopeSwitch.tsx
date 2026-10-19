import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { IconButton } from '../Tip';

// "Allow edits anywhere" in the chat head of a flow chat: off (the default), the scope guard keeps this chat's edit
// scripts inside its own flow subsection; on, it may edit other flows and iterations. Per chat, until turned off.

/** "flows/02-connectors/iterations/1.19" -> { flow: "connectors", iteration: "1.19" }; null for any other folder. */
export function flowChatOf(cwd: string): { flow: string; iteration: string } | null {
  const m = /[\\/]flows[\\/]\d+-([^\\/]+)[\\/]iterations[\\/]([^\\/]+)[\\/]?$/.exec(cwd ?? '');
  return m ? { flow: m[1], iteration: m[2] } : null;
}

export function ScopeSwitch() {
  const cwd = useStore((s) => s.session.cwd);
  const on = useStore((s) => Boolean(s.session.editsAnywhere));
  const at = flowChatOf(cwd);
  if (!at) return null;
  // An icon toggle, since the chat head is narrow: a lock while the guard is on, an open lock when edits go anywhere.
  const tip = on ? 'Allow edits anywhere: On. This chat can edit other flows and iterations.' : `Allow edits anywhere: Off. This chat edits only its own flow in ${at.iteration}.`;
  return (
    <IconButton label="Allow edits anywhere" tip={tip} aria-pressed={on} className={`icon-btn scope-switch${on ? ' on' : ''}`} onClick={() => send({ type: 'set_edits_anywhere', on: !on })}>
      <Icon name={on ? 'unlock' : 'lock'} small />
    </IconButton>
  );
}
