import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { nextSide, nextStep, park, placeAfter, renumber, tidy, type Board, type Frame } from '../../../shared/canvas/index.js';
import { manifest } from './app.js';
import { boardPlace, readBoard, writeBoard } from './board.js';
import { projectOf } from './paths.js';

// Claude's tools for the canvas board of its chat (a flow chat's iteration board, else the main board): read it, add
// frames and arrows, change a frame, tidy the layout. The open Canvas tab reloads the board after each change.

const listeners = new Set<(cwd: string) => void>();
export function onBoardChanged(fn: (cwd: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const rid = () => Math.random().toString(36).slice(2, 10);
const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) });
const GAP = 240;

async function change(cwd: string, go: (b: Board, screens: Awaited<ReturnType<typeof manifest>> | null) => Board | string) {
  const project = await projectOf(cwd);
  const place = await boardPlace(project, cwd);
  const board = await readBoard(place);
  const screens = await manifest(project).catch(() => null);
  const next = go(board, screens);
  if (typeof next === 'string') return text(next, true);
  try {
    await writeBoard(place, next);
  } catch (e) {
    return text((e as Error).message, true);
  }
  for (const fn of listeners) fn(cwd);
  return text(describe(next));
}

function describe(b: Board): string {
  const frame = (f: Frame) => `- ${f.id}: ${f.n ? `step ${f.n} ` : ''}"${f.name}" ${f.route} [${f.scenario}]${f.clicks?.length ? ` after clicking ${f.clicks.map((c) => `"${c}"`).join(', ')}` : ''}${f.parked ? ' (tried option)' : f.group ? ` in section "${f.group}"` : ''}${f.note ? ` note: ${f.note.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`;
  const name = (id: string) => b.frames.find((f) => f.id === id)?.name ?? id;
  return [
    `${b.name}: ${b.frames.length} frames, ${b.links.length} arrows.`,
    ...b.frames.map(frame),
    ...b.links.map((l) => `- arrow ${l.id}: ${name(l.from)} to ${name(l.to)} "${l.label}"`),
  ].join('\n');
}

export function canvasTools(cwd: string) {
  return [
    tool(
      'canvas_read',
      'The canvas board of this chat (a flow chat\'s board of its iteration, else the project\'s main board): its frames with step numbers, routes, states and notes, its arrows, and the app\'s screens and states to choose from.',
      {},
      async () => {
        const project = await projectOf(cwd);
        const board = await readBoard(await boardPlace(project, cwd));
        const m = await manifest(project).catch(() => null);
        const app = m ? `\nScreens: ${m.screens.map((s) => `${s.route} "${s.name}"`).join(', ')}\nStates: ${m.scenarios.map((s) => s.id).join(', ')}` : '\nThe app is not running, so its screens are unknown.';
        return text(describe(board) + app);
      },
    ),
    tool(
      'canvas_add_frame',
      'Adds a frame of the running app to the board, placed after another frame. Give a step ("2", or "2.1" for a side state of step 2) or let it take the next one; clicks are button or link labels clicked after the screen loads, to show a side state such as an open dialog.',
      {
        route: z.string().max(300).describe('The screen\'s route, like "/connectors".'),
        scenario: z.string().max(60).optional().describe('The state id; default the first state, or the state of the frame it follows.'),
        after: z.string().max(40).optional().describe('The id of the frame it follows; an arrow joins them when label is given.'),
        label: z.string().max(120).optional().describe('The arrow\'s label, naming the click, like "Click Open".'),
        n: z.string().max(12).optional(),
        name: z.string().max(120).optional(),
        note: z.string().max(600).optional(),
        clicks: z.array(z.string().max(60)).max(10).optional(),
        section: z.string().max(80).optional().describe('A section name, like "Happy path", "Empty" or "Error"; default the section of the frame it follows.'),
      },
      async (a) => change(cwd, (b, m) => {
        if (!a.route.startsWith('/') || a.route.startsWith('//')) return 'The route must start with /';
        const from = a.after ? b.frames.find((f) => f.id === a.after) : b.frames.at(-1);
        if (a.after && !from) return `There is no frame ${a.after}`;
        const flowBoard = b.frames.some((f) => f.n) || !!a.n;
        const n = a.n ?? (flowBoard || !b.frames.length ? (a.clicks?.length && from?.n ? nextSide(b.frames, from.n) : nextStep(b.frames)) : undefined);
        const size = from ?? { w: 1280, h: 800 };
        const at = from ? placeAfter(b.frames, from, GAP) : { x: 0, y: 0 };
        const f: Frame = {
          id: rid(), route: a.route, scenario: a.scenario ?? from?.scenario ?? m?.scenarios[0]?.id ?? 'default',
          name: a.name ?? m?.screens.find((s) => s.route === a.route.split('?')[0])?.name ?? a.route,
          ...at, w: size.w, h: size.h, ...(n ? { n } : {}), ...(a.note ? { note: a.note } : {}), ...(a.clicks?.length ? { clicks: a.clicks } : {}),
          ...((a.section ?? from?.group) ? { group: a.section ?? from?.group } : {}),
        };
        return { ...b, frames: [...b.frames, f], links: from && a.label ? [...b.links, { id: rid(), from: from.id, to: f.id, label: a.label }] : b.links };
      }),
    ),
    tool(
      'canvas_add_arrow',
      'Joins two frames on the board with an arrow labelled with the click that leads from one to the other.',
      { from: z.string().max(40), to: z.string().max(40), label: z.string().max(120).describe('Like "Click Nudge managers".') },
      async (a) => change(cwd, (b) => {
        if (!b.frames.some((f) => f.id === a.from) || !b.frames.some((f) => f.id === a.to)) return 'Both frames must be on the board';
        return { ...b, links: [...b.links.filter((l) => !(l.from === a.from && l.to === a.to)), { id: rid(), from: a.from, to: a.to, label: a.label }] };
      }),
    ),
    tool(
      'canvas_update_frame',
      'Changes one frame: its name, step, note, state or section ("" takes it out of its section), parks it as a tried option (kept to the side, out of the flow) or brings it back, or removes it. Steps close up after a removal or a park.',
      {
        id: z.string().max(40),
        name: z.string().max(120).optional(),
        n: z.string().max(12).optional(),
        note: z.string().max(600).optional(),
        scenario: z.string().max(60).optional(),
        section: z.string().max(80).optional(),
        parked: z.boolean().optional(),
        remove: z.boolean().optional(),
      },
      async (a) => change(cwd, (b) => {
        const f = b.frames.find((x) => x.id === a.id);
        if (!f) return `There is no frame ${a.id}`;
        if (a.remove) return { ...b, frames: renumber(b.frames.filter((x) => x.id !== a.id)), links: b.links.filter((l) => l.from !== a.id && l.to !== a.id) };
        const patch: Partial<Frame> = { ...(a.name ? { name: a.name } : {}), ...(a.n ? { n: a.n } : {}), ...(a.note !== undefined ? { note: a.note } : {}), ...(a.scenario ? { scenario: a.scenario } : {}), ...(a.section !== undefined ? { group: a.section.trim() || undefined } : {}) };
        let frames = b.frames.map((x) => (x.id === a.id ? { ...x, ...patch } : x));
        if (a.parked !== undefined) frames = park(frames, a.id, a.parked);
        return { ...b, frames };
      }),
    ),
    tool(
      'canvas_tidy',
      'Lays the board out like Figma flow sections: frames outside a section first, then each section as its own band (steps in a row in order, side states under their step), tried options last.',
      {},
      async () => change(cwd, (b) => ({ ...b, frames: tidy(b.frames) })),
    ),
  ];
}
