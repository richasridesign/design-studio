// The Canvas tab's board: frames of the prototype app (a route, a scenario and a size) placed on a plane. Saved as
// canvas/boards/main.json in the project, or a flow iteration's canvas.json. A frame never copies a screen; it points
// at the running app.

/**
 * n is the step in a flow ("1", "3.1") and note the short text under the frame, as on her Figma flow sections. clicks
 * are the labels clicked after the screen loads, to reach a side state such as an open dialog. A parked frame is a
 * tried option, kept to the side of the flow. figma links the frame to its screen in Figma. group names the section the
 * frame sits in ("Happy path", "Empty").
 */
export type Frame = {
  id: string; name: string; route: string; scenario: string; x: number; y: number; w: number; h: number;
  n?: string; note?: string; clicks?: string[]; parked?: boolean; figma?: string; group?: string;
};
/** An arrow from one frame to the next, labelled with the click that leads there ("Click Open"). */
export type Link = { id: string; from: string; to: string; label: string };
export type Board = { version: 1; name: string; frames: Frame[]; links: Link[] };

export const SIZES = [
  { id: 'desktop', label: 'Desktop', w: 1440, h: 900 },
  { id: 'laptop', label: 'Laptop', w: 1280, h: 800 },
  { id: 'tablet', label: 'Tablet', w: 834, h: 1112 },
  { id: 'phone', label: 'Phone', w: 390, h: 844 },
] as const;

export type CanvasState = 'none' | 'creating' | 'installing' | 'starting' | 'running' | 'stopped' | 'failed';
export type CanvasStatus = { state: CanvasState; step?: string; error?: string; url?: string; hasProfile?: boolean };
export type Manifest = { screens: { route: string; name: string }[]; scenarios: { id: string; name: string }[] };

/** One inspector change: the element's text, one attribute (value null removes it), or the element itself taken out,
 * copied after itself or moved past its neighbour. */
export type CanvasOp = { kind: 'text'; value: string } | { kind: 'attr'; name: string; value: string | null } | { kind: 'flag'; name: string; value: boolean }
  | { kind: 'remove' } | { kind: 'duplicate' } | { kind: 'move'; by: -1 | 1 }
  | { kind: 'wrap'; class: string } | { kind: 'add'; tag: 'p' | 'span' | 'div' | 'h2' | 'h3'; class: string; text: string };
export type CanvasAttr = { name: string; kind: 'string' | 'expr' | 'bool'; value?: string; raw?: string };
/** A component's props as canvas-core reads them from its file: variants, strings, numbers, switches. */
export type CanvasPropType = { kind: 'variant'; options: string[] } | { kind: 'string' } | { kind: 'number' } | { kind: 'boolean' } | { kind: 'other'; raw: string };
export type CanvasProp = { name: string; optional: boolean; type: CanvasPropType; default?: string };
export type CanvasComponent = { name: string; line: number; props: CanvasProp[] };
/** What the canvas changed in the app: uncommitted files, and this session's edits (newest first) for undo. */
export type CanvasChanges = { files: { file: string; state: 'changed' | 'new' | 'deleted'; added: number; removed: number }[]; edits: { label: string; file: string; at: number }[] };
export type CanvasElement = { tag: string; line: number; col: number; attrs: CanvasAttr[]; text: string | null; selfClosing: boolean };

export const emptyBoard = (): Board => ({ version: 1, name: 'Main board', frames: [], links: [] });
