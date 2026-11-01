# Figma API for chats

Status: draft for review, 1 Nov 2026. Nothing here is built yet.

## What the data says

Source: every Figma call in the design chats of the last 30 days. 94 chats, 342 turns, 2,159 scripts.

| | |
|---|---|
| Time running scripts (mostly the Figma MCP) | 399 min, median 5.0 s a call |
| Time Claude spent writing the next script | 462 min, median 8.7 s a step |
| Script length | median 826 characters, 1 in 10 over 2,800 |
| Failed calls | 173 (8%), 45 of them retried with nearly the same code |

Through Design Studio's plugin a script now runs in about 1 s, so **Claude's steps are the cost left**: each extra call is one more 5 to 14 s step.

**Where the steps go**

- **Long turns.** Turns with 8 or more calls are 16% of turns but hold 340 of the 462 minutes (74%). They are build and merge jobs: clone a version, rework screens, rewire links, add notes and stickies.
- **Discovery.** 766 calls (35%, 146 min) only look: "inspect structure", "tree of screen 2", "read components and variants used", "measure padding". A chat often makes 3 to 6 of them before the first edit, each returning a slice of what it needs.
- **Locating things.** 1,001 scripts find a screen by name or number ("screen 5", "3.1"), 476 walk up `.parent` to learn which screen or section a layer is in, 837 search text. Text find-then-change, which started this work, is only about 10% of calls.
- **Prototype links.** 381 calls read links, 271 write them, 229 of those copy links onto cloned screens with a hand-written remap loop (about 2,400 characters each time). 8 calls failed on a link to a node on another page.
- **Errors with one cause each.** Links to an invalid destination (8), `setCurrentPageAsync` given a node that is not a page (4), `findAll` or `findOne` on a text layer (6), a node id that no longer exists (8), plugin data namespace too short (4), an unloaded font when setting text sizing (3).

## Decision: one script tool, a bigger kit

Chats keep two Figma tools, `mcp__designstudio__use_figma` (a script) and `mcp__designstudio__get_screenshot`, and the work moves into new `DS` helpers. No new typed tools.

Why: a typed tool (say `figma_find_text`) still costs a full Claude step to call and another to read its answer, the same as a script. The steps disappear only when one call does more, and a script can find, change, check and screenshot in one call, which typed tools cannot chain. The kit makes those scripts short (less to write per step) and complete (no follow-up look).

Not doing:
- **An index of the file.** A whole-page search is 0.2 s in the plugin. An index would save that and go stale on every edit.
- **Typed tools per operation.** See above.

## Data model

How Design Studio reads a file, from the design-process rules. The helpers return these names, so Claude does not walk the tree to find them.

| Thing | How it is recognised |
|---|---|
| Page | a Figma page |
| Version section | a top-level section named `V0.N · Flow N · topic · Weekday date` |
| Flow subsection | a section inside a version section |
| Option | a subsection tagged `designstudio_option` or named `… · Option A: name` |
| Screen | a frame or component directly in a (sub)section; its number is the leading `N` or `N.M` of its name |
| Flow note, Branch label, arrow | instances of the Flow note component (Note, Branch label) and connector lines between screens |
| Decision sticky | an instance of the Decision component, tagged `designstudio_decision` |
| Label | the nearest text above a layer inside its screen (a step label such as `STEP 2 · REVIEW`, a column header, a field label) |

`Where` is the context object every locating helper returns:

```ts
type Where = {
  page: string;                       // page name
  version?: { id: string; name: string };   // V0.N section
  flow?: { id: string; name: string };      // flow subsection
  option?: 'A' | 'B' | 'C';
  screen?: { id: string; name: string; number?: string }; // number: "5", "3.1"
  label?: string;                     // nearest label above, inside the screen
  inInstance?: { id: string; component: string }; // the outermost instance it sits in, if any
};
```

## Helpers

New helpers, in the order they save the most time. Existing helpers (`DS.node`, `DS.setText`, `DS.setVariant`, `DS.check`, `DS.decisions`, `DS.shot` and the rest) stay as they are.

### 1. `DS.describe(node | id | [ids], { depth = 4, max = 300 })`

Everything Claude usually reads before an edit, in one compact outline. Replaces the discovery calls (766 calls, 146 min).

One line per layer, nested by indent:

```
12:40 FRAME "5 Draft" 1440x900 auto V pad 24/24/32/32 gap 16 fill bg/page
  12:41 INSTANCE Page header {Type=Default} title="Draft" overrides: title
  12:52 FRAME "timeline" auto V gap 8 hug
    12:53 INSTANCE Timeline item {Kind=Step} label="STEP 2 · REVIEW"
      12:54 TEXT "Reminds once, then tells the owner" Poppins 12/16 text/secondary
  12:60 INSTANCE Button {Type=Primary, State=Default} "Publish" → click: 6 Published
```

Per layer, only what is set: layout (direction, padding, gap, sizing), fills and strokes as variable names (hex only when unbound), text with font and size, instance with component set, variant and overridden fields, prototype links as `trigger: destination screen name`, `hidden`. Stops at `max` lines and says where to go deeper.

### 2. `DS.where(node)` and `{ where: true }` on searches

`DS.where(node)` returns the `Where` above. `DS.find`, `DS.texts` and `DS.one` take `{ where: true }` and return `[{ id, name, text?, where }]`. Replaces parent-walk loops (476 calls) and the follow-up reads after a text search (837 calls). A text change becomes one call when every match is the same line, two when matches differ.

### 3. `DS.screen(ref, scope?)` and `DS.screens(scope)`

`DS.screen("3.1", flowSection)` or `DS.screen("Draft", versionSection)` gives the screen node; with no scope it searches the current page, and throws with the near matches when it finds none or several. `DS.screens(scope)` lists `[{ id, name, number }]` in flow order. Replaces 1,001 locate-by-name scripts.

### 4. `DS.links(root)`, `DS.link(from, to, opts)`

- `DS.links(root)` gives `[{ from, fromName, screen, trigger, nav, to, toName, toScreen }]` for every prototype link under `root`.
- `DS.link(from, to, { on: 'click' | 'hover' | 'timeout', nav: 'navigate' | 'overlay' | 'change', seconds?, position? })` sets one link, keeping the layer's other links, and throws when the destination is gone, on another page, or not a top-level frame (the 8 invalid-destination errors).

Replaces about 380 read scripts and the boilerplate in 270 write scripts.

### 5. `DS.cloneSection(section, { name, below, gap = 400 })`

Clones a version or flow section under the lowest section in its column, points every link that pointed inside the source at the matching clone, drops links that left the page, and moves Decision sticky and flow note tags to the copied screens. Returns `{ section, screens: { oldId: newId }, linksMoved, linksDropped }`. Replaces the hand-written remap loop (229 calls, about 2,400 characters each).

### 6. `DS.flow(section, steps)`, `DS.note`, `DS.arrow`

`DS.flow(section, [{ screen: "1", title, body }, { screen: "1.1", click: "Click Save", title, body }])` lays out the flow notes from the design-process rules in one call: a Note 96px under each screen (Decision stickies moved 32px under it), and an arrow from the step before (or `from`) with a 300px Branch label naming the click. A rerun updates the notes in place. `DS.note(screen, { title, body })` and `DS.arrow(from, to, { click })` do one each. Notes are tagged to their screen, so `DS.cloneSection` keeps them with the copies.

### 7. `DS.fonts(node)`

Loads every font in a layer, before setting `textAutoResize` or other text properties by hand (the most common font error).

### 8. Guards

- `DS.page(id)` already takes any node; the plugin's `figma.setCurrentPageAsync` will accept any node too and move to its page.
- `DS.find`, `DS.one` and `DS.texts` on a text layer return that layer or nothing instead of throwing.
- `DS.setText` loads every font in the layer before any property change, not only for `characters`.
- `DS.node` already names a missing id. No change.

## Chat instructions

Added to the Figma part of the chat prompt, about 6 lines (every line goes into every chat):

1. Plan, then build: one read of everything the job touches (`DS.describe` on the screens, `DS.texts` or `DS.find` with `{ where: true }`), decide every change, then one call per group of screens that edits, ends with `DS.check` and `DS.shot`, and returns what the next call needs.
2. Locate by `DS.screen` and search with `{ where: true }`. Do not walk `.parent`.
3. Text matches on the same line change in one call.

How Claude reasons on each step (model and effort) stays as it is for now.

## Expected effect

Why about a third and not two thirds: helpers cut the calls, not the cost of each call. A step costs 1.9 s plus 6.9 ms per output token, and of the median 870 output tokens only about 250 are code; the rest is Claude reasoning about what to do next, which a helper does not remove. Fewer, larger steps remove the fixed cost and the repeated reasoning between small reads, which is where the third comes from. Going further means shorter reasoning per step (model or effort), which is out of scope here.

An estimate, not a measurement: discovery halved (about 70 min), text and screen lookups without follow-up reads (about 40 min), link and clone boilerplate gone (about 40 min). About a third of Claude's step time, so a long build turn drops from roughly 6 minutes of steps to 4. Measured afterwards with the same script on the next 30 days.

## Tests

Only what can lose work or point at the wrong thing:
- `DS.cloneSection` remaps links inside the copy and never leaves a link pointing into the source.
- `DS.link` refuses a destination on another page.
- `DS.where` names the right screen and label for a nested text layer.

Checked read-only on a 591-screen file through the plugin: `DS.screens` 220 ms, `DS.links` on a screen 59 ms, `DS.screen` 8 ms, `DS.describe` at depth 3 under 100 ms, `DS.texts` with `where` on a version section 255 ms. The write helpers (`cloneSection`, `flow`, `link`) are covered by the unit tests and still need a live run on a scratch file.

## Open question

"Model" here means the data model. Since Claude's steps are now most of a turn, a faster Claude model for Figma steps is a separate lever, not part of this spec.
