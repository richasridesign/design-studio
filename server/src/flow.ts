import { fixRoundsFor, type FigmaFile, type Finding, type FlowKind, type ReviewPreset, type SketchDoc } from '../../shared/design.js';
import { chosenSummary } from './sketch.js';
import { loadedSettings } from './settings.js';

const SKETCH_FORMAT = `sketch.json format:
{ "screens": [ { "id": "home", "name": "Home", "chosen": "a", "directions": [
  { "id": "a", "name": "Card list", "rationale": "one line on why", "w": 390, "h": 844,
    "items": [ { "t": "heading", "x": 24, "y": 64, "w": 200, "h": 32, "label": "Orders" } ] } ] } ] }
Item types: box, text, heading, button, input, image, icon, line, circle, note. Coordinates in px inside the direction's w x h. Use "note" for a short annotation.`;

export function planPrompt(task: string, figma: FigmaFile | null, kind: FlowKind) {
  return [
    `This is a Design Studio ${kind === 'sketch' ? 'sketch' : 'design'} run. Phase 1: plan. Later phases sketch${kind === 'design' ? ', design in Figma and review' : ''} with another model, so the plan must stand on its own.`,
    figma ? `The Figma file is ${figma.name} (${figma.url}).` : 'No Figma file is linked to this chat yet.',
    'Read design-system.md in this folder if it exists. Look at the Figma file with the read-only Figma tools only where it helps. Do not ask the user questions: decide, and list what you assumed.',
    'Write a short brief with these headings: Goal, Users, Screens (an id and a name for each), States per screen (empty, loading, error, success where they apply), Components per screen (library component names), Layout (mobile 390x844 or desktop 1440x900), Assumptions.',
    'Then call ExitPlanMode with the brief as the plan. The run continues automatically after that.',
    '',
    'Request:',
    task,
  ].join('\n');
}

export function sketchPrompt(stopAfterSketch: boolean) {
  return [
    'Phase 2: sketch. Write sketch.json in this folder with two or three low-fidelity directions per screen from the brief in plan.md. Directions should differ in structure, not only in color. Keep each direction to 10 to 40 items.',
    stopAfterSketch ? 'Leave "chosen" out: the designer picks a direction for each screen.' : 'Set "chosen" on each screen to the direction you recommend.',
    'Do not use the Figma tools in this phase.',
    SKETCH_FORMAT,
    'Finish with set_status and a one-line summary per screen.',
  ].join('\n\n');
}

export function sketchFixPrompt(error: string) {
  return `sketch.json could not be read: ${error}. Fix the file so it matches the format and finish.\n\n${SKETCH_FORMAT}`;
}

const sentence = (t: string) => (t && !/[.!?]$/.test(t) ? `${t}.` : t);

/** One line per screen for the design phase: the direction, what it was picked over, and the designer's reason. */
function pickLine({ screen: s, direction: d }: ReturnType<typeof chosenSummary>[number]) {
  const parts = [`- ${s.name}: ${d.name}.`, sentence(d.rationale)];
  if (s.chosen === d.id) {
    const over = s.rejected ?? s.directions.filter((x) => x.id !== d.id).map((x) => x.name);
    const designer = s.chosenBy === 'designer';
    if (over.length) parts.push(`${designer ? 'The designer picked it' : 'Picked'} over ${over.join(', ')}.`);
    // A confirmed Claude pick carries the rationale as its reason; say it once.
    if (designer && s.reason && s.reason !== d.rationale.slice(0, s.reason.length)) parts.push(`Why: ${sentence(s.reason)}`);
  }
  return parts.filter(Boolean).join(' ');
}

/** Only the designer's own picks: Claude writing sketch.json never counts as a change. */
export const designerPicksKey = (sketch: SketchDoc | null) =>
  JSON.stringify((sketch?.screens ?? []).filter((s) => s.chosenBy === 'designer').map((s) => [s.id, s.chosen, s.reason ?? '']));

/** Told to Claude when the designer changes a pick or its reason, so later work follows it. */
export function picksNote(sketch: SketchDoc | null) {
  const chosen = sketch ? chosenSummary(sketch).filter((c) => c.screen.chosen) : [];
  return chosen.length ? `The designer changed the sketch picks. Follow these from now on:\n${chosen.map(pickLine).join('\n')}` : '';
}

export function designPrompt(sketch: SketchDoc | null, hasProfile: boolean, task: string, notes: string[] = []) {
  const chosen = sketch ? chosenSummary(sketch) : [];
  return [
    'Phase 3: design. Build the screens from plan.md in Figma at high fidelity.',
    '1. Figma keeps its own version history. Do not call saveVersionHistoryAsync: use_figma does not support it and the call fails.',
    '2. Put new work on a page named "Design Studio" (create it if missing). Do not edit frames on other pages. To change an existing frame, duplicate it onto the Design Studio page and work on the copy.',
    chosen.length ? `3. Put the chosen sketches on a page named "Sketch" with upload_assets, as a record. Files: ${chosen.map((c) => c.file).join(', ')}.` : '3. There are no sketches for this run.',
    `4. Build one frame per screen and state, left to right, named "<Screen> / <State>". Cover every state in the States section of plan.md; the Build gate checks each one. ${hasProfile ? 'Use the library components, variables and text styles listed in design-system.md: import components by key, bind fills and strokes to color variables, apply text styles, use auto layout with spacing from the scale.' : 'There is no design system profile; use the components, variables and styles the file already uses.'}`,
    '5. Call set_status with nodes set to the frame you are working on, so the designer can follow along.',
    '6. When done, write design.json in this folder: { "page": "Design Studio", "frames": [ { "screen": "home", "state": "default", "nodeId": "12:34", "name": "Home / Default" } ] }. The review reads this file.',
    chosen.length ? `Chosen sketch directions. Follow the designer's reasons where given:\n${chosen.map(pickLine).join('\n')}` : '',
    notes.length ? `The designer wrote these notes on the sketches. Follow them:\n${notes.map((n) => `- ${n}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export const designFilePrompt = 'design.json is missing or lists no frames. Write it now with every frame you created: { "page": "Design Studio", "frames": [ { "screen": "...", "state": "...", "nodeId": "12:34", "name": "..." } ] }';

export function fixPrompt(findings: Finding[], round: number) {
  const list = findings.slice(0, 40).map((f, i) => `${i + 1}. [${f.severity}, ${f.area}] ${f.nodeName ? `"${f.nodeName}" ` : ''}${f.node}: ${f.rule} Fix: ${f.fix}`);
  return [
    `Phase 4: fix, round ${round}. The review found these problems in the Design Studio frames:`,
    list.join('\n'),
    findings.length > 40 ? `…and ${findings.length - 40} more of the same kinds.` : '',
    `Fix them in Figma. Leave everything else as it is. Do not change shared variables, main components or styles, and do not remove features: those changes wait for the designer. Update design.json if frames change. Finish with a short summary of what you fixed and anything you left alone and why.`,
  ].filter(Boolean).join('\n\n');
}

export type AfterReview = { next: 'fix' | 'review' | 'verify' | 'done'; fixes: Finding[] };

/** rounds: the Fix rounds setting. Quick and Check fix once whatever it says. */
export function afterReview(preset: ReviewPreset, fixesDone: number, toFix: Finding[], rounds = loadedSettings().fixRounds): AfterReview {
  if (toFix.length === 0) return { next: 'done', fixes: [] };
  if (fixesDone < fixRoundsFor(preset, rounds)) return { next: 'fix', fixes: toFix };
  return { next: 'done', fixes: toFix };
}

export function afterFix(preset: ReviewPreset, fixesDone: number, rounds = loadedSettings().fixRounds): 'review' | 'verify' {
  return fixesDone < fixRoundsFor(preset, rounds) ? 'review' : 'verify';
}

export function parseCommand(text: string): { cmd: 'design' | 'sketch' | 'review' | 'audit' | 'system' | 'crit' | 'copy' | 'buildcheck'; arg: string } | null {
  const m = /^\/(design|sketch|review|audit|system|crit|copy|buildcheck)\b\s*([\s\S]*)$/.exec(text.trim());
  return m ? { cmd: m[1] as 'design', arg: m[2].trim() } : null;
}
