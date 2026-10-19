/** The reply to a typed /design or /sketch: design runs became the From scratch workflow. */
export const DESIGN_MOVED = 'Design runs moved to From scratch. Switch the workflow above the chat.';

export function parseCommand(text: string): { cmd: 'design' | 'sketch' | 'review' | 'audit' | 'system' | 'crit' | 'copy' | 'buildcheck'; arg: string } | null {
  const m = /^\/(design|sketch|review|audit|system|crit|copy|buildcheck)\b\s*([\s\S]*)$/.exec(text.trim());
  return m ? { cmd: m[1] as 'design', arg: m[2].trim() } : null;
}
