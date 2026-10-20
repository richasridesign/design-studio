import { useStore } from './store';
import { frameName, useOutline } from './outline';
import { showNode } from './panes/composerEvents';

/**
 * Frame ids as screen names, each a link that shows it in Figma. A review saves each frame's screen and section
 * ("Activate · Empty state"); older runs fall back to the file outline, which knows only frames at the top of a page,
 * and the id only when neither has a name. Ids in the same screen show once.
 */
export function FrameNames({ ids, names, max = 3 }: { ids: string[]; names?: Record<string, string>; max?: number }) {
  const outline = useOutline(useStore((s) => s.session.figma?.key));
  const seen = new Set<string>();
  const shown: Array<{ id: string; label: string }> = [];
  for (const id of ids) {
    const label = names?.[id] || frameName(outline, id) || id;
    if (seen.has(label)) continue;
    seen.add(label);
    shown.push({ id, label });
  }
  return (
    <>
      {shown.slice(0, max).map(({ id, label }, i) => (
        <span key={id}>{i > 0 && ', '}<button className="link" title="Show in Figma" onClick={() => showNode(id)}>{label}</button></span>
      ))}
      {shown.length > max && ` +${shown.length - max} more`}
    </>
  );
}
