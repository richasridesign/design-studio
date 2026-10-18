import { useStore } from './store';
import { frameName, useOutline } from './outline';
import { showNode } from './panes/Files';

export function FrameNames({ ids, max = 3 }: { ids: string[]; max?: number }) {
  const outline = useOutline(useStore((s) => s.session.figma?.key));
  return (
    <>
      {ids.slice(0, max).map((id, i) => (
        <span key={id}>{i > 0 && ', '}<button className="link" title="Show in Figma" onClick={() => showNode(id)}>{frameName(outline, id) ?? id}</button></span>
      ))}
      {ids.length > max && ` +${ids.length - max} more`}
    </>
  );
}
