# Design Studio plan

AgentView for designers. Same shell (Claude Code on the Agent SDK, timeline, phone, menu bar app), but the workspace is
Figma files instead of git repos, the center shows Figma in the designer's own Chrome, and the core workflow is
plan, sketch, design, review instead of plan, build, test.

## Who it is for

Product designers who have Figma and a Claude seat but do not use a terminal. They never see cwd, repo, permission
mode, MCP or a shell. They start a chat from a Figma link or a brief, watch Claude sketch and then design in Figma,
read the review, and step in when they want to. Claude edits the file without asking; the designer reviews afterwards.

## What exists

- AgentView (`~/workspace_personal/agentview`): server on :7777 running `query()` from the Agent SDK with a
  `set_status` tool, approvals, loop mode (`server/src/loop.ts`), team models, transcript history, Chrome relay and
  Browser pane, notifications, menu bar app, Tauri phone shell. Web: React + Vite, VS Code layout.
- Figma in the browser through the Chrome relay. Tested: Claude and the Figma MCP work against figma.com in the
  designer's logged-in Chrome.
- Figma MCP server, remote `https://mcp.figma.com/mcp` with OAuth through Claude. Writes: `use_figma` (Plugin API
  scripts that create, edit and delete nodes), `html_to_figma`, `upload_assets`, `generate_diagram`, `create_new_file`.
  Reads: `get_design_context`, `get_screenshot`, `get_metadata`, `get_variable_defs`, `search_design_system`,
  `get_libraries`, `download_assets`, `whoami`. Writes are beta, free for now, later usage-based, and need a Full seat
  outside drafts.
- Figma plugin for Claude Code (`figma@claude-plugins-official`) with the server config and Figma's workflow skills.
- Figma REST API (personal access token): projects, files, file tree, node renders, comments, versions. The Design Studio
  server uses it for its own UI. Claude uses the MCP.

## Decisions

1. **Fork AgentView into this repo.** Session, timeline, composer, notifications, menu bar and phone code carry over.
   Git, GitHub, deploy, worktrees, Observe and the repo Explorer are removed. Terminal and the code editor stay behind
   a setting for prototype work.
2. **Figma runs in the designer's Chrome, shown through the Chrome relay.** The Figma tab in the center is the existing
   Browser pane pinned to the file's figma.com tab. The designer can click into it and edit, and Claude can drive it
   with Claude in Chrome when the MCP cannot do something. When Claude reports nodes in `set_status`, the tab moves to
   the latest node.
3. **The workflow is plan, sketch, design, review.** It replaces AgentView's loop phases and is the default for any
   design request. Each phase is a marker in the timeline and a step in the task box. It runs end to end by default;
   a "Stop after sketch" toggle lets the designer pick the direction before Claude designs.
4. **Sketch is a Design Studio page, not Figma.** It is an Excalidraw canvas. Claude writes low-fidelity wireframes as
   Excalidraw JSON, several directions per screen, in seconds and without Figma write calls. The designer can draw over
   them, annotate, and mark one "Use this", on the desktop or with a finger on the phone. The chosen sketch is copied
   to a "Sketch" page in the Figma file as an image so the history stays with the file.
5. **Design always uses the design system.** At chat start Design Studio builds a design system profile from the file's
   libraries: color and other variables with modes, text styles, components with keys, variants and properties,
   spacing and radius scales, and rules from `create_design_system_rules`. It is cached in the chat folder and
   refreshed when a library publishes. The design phase imports library components by key and binds variables; raw
   hex values, unstyled text and detached instances are review failures.
6. **Review is a choice of presets, cheapest by default.** Every review starts with a design system check that uses no
   model at all: the server reads the frames through the Figma REST API and flags fills and strokes without a bound
   variable, text without a library style, instances that are not library components, contrast below 4.5:1, targets
   under 44px and spacing off the scale. Model reviewers only judge what rules cannot, such as hierarchy, consistency
   and whether the design fits the brief. The designer picks how much of that to run:

   | Preset | What runs | Fix rounds |
   | --- | --- | --- |
   | Check | Design system check only, no model calls | Claude fixes the flagged items once |
   | Quick (default) | Check plus one reviewer covering all areas in a single pass | 1 |
   | Focused | Check plus one reviewer per area the designer ticks | 1 |
   | Full | Check plus all six area reviewers in parallel | Up to 2, re-running only failed areas |

   The six areas are color, typography, spacing and layout, components, accessibility, and brief fit. Each reviewer
   gets only its section of the profile, the brief, and screenshots the server took once and shares. Findings are
   `{ area, node, severity, rule, fix }`; the design agent fixes blocking and major ones and leaves minor ones listed.
   The preset is a menu in the task box, with the designer's last choice remembered. The Review page shows the tokens
   each run used next to its findings, so designers can compare presets on their own work.
7. **Unattended editing from day one, with checkpoints.** Before the first write in a turn, a PreToolUse hook on
   `use_figma` makes sure a version is saved (`figma.saveVersionHistoryAsync("Design Studio: <task>")`). Figma cannot
   restore a version by API, so the timeline links to version history. "Ask before changing the file" is an opt-in mode.
8. **Work lands on a "Design Studio" page.** Claude never edits existing frames in place unless the prompt says so. To
   change an existing frame it duplicates it onto the Design Studio page, works on the copy, and replaces the original only
   when asked, with before and after screenshots in the timeline.
9. **A chat belongs to a Figma file, with a folder behind it.** `~/Design Studio/<file-key>/` holds the plan, sketches,
   the design system profile, screenshots, review results, prototypes and the transcript. The designer never sees it.
10. **Opus 5.5 plans, Sonnet 5.5 does the rest.** The plan phase runs on Opus 5.5. Sketch, design, fix rounds and
    every reviewer run on Sonnet 5.5. The phase engine switches the model at the phase change, the same way AgentView's
    loop mode already switches between plan and build. There is no model menu and no Fable call.
11. **Light theme, large text.** One light theme at launch. Body text 16px against VS Code's 13px, nothing under 13px,
    line height 1.5, rows and buttons at least 36px. AgentView has 267 hard-coded font sizes, mostly 11 to 13px; they
    become six tokens, so the scale can change in one place.

    | Token | Size | Used for |
    | --- | --- | --- |
    | `--text-xs` | 13px | Badges, timestamps |
    | `--text-sm` | 14px | Secondary text, sidebar meta |
    | `--text-md` | 16px | Body, timeline, composer, lists |
    | `--text-lg` | 18px | Pane titles, card titles |
    | `--text-xl` | 22px | Page section headings |
    | `--text-2xl` | 28px | Page titles |

## Layout

- **Sidebar**: Files (projects and files from the REST API, frames of the open file with thumbnails), Chats (open and
  recent), Design System (variables, text styles and components from the profile).
- **Center tabs**: Figma (the Chrome tab), Sketch (Excalidraw canvas with the plan's screens in rows and directions in
  columns), Review (one column per reviewer with pass or fail, findings linked to nodes with screenshots), Preview
  (HTML prototypes from the chat folder).
- **Right**: Task box with a phase stepper (Plan, Sketch, Design, Review) above the timeline. The current phase opens
  its tab: sketch shows Sketch, design shows Figma, review shows Review.
- **Phone**: Timeline, Sketch, Figma, Review. The Figma tab is a read-only view of the relay.

## Workflow phases

1. **Plan.** Claude reads the request, the file and the design system profile, then writes a short brief: goal, users,
   screens, states per screen, components it expects to use, open questions. In unattended mode it answers its own open
   questions and lists the assumptions in the timeline.
2. **Sketch.** Two or three directions per screen on the Sketch page, each with a one-line rationale. Claude picks one
   and says why, unless "Stop after sketch" is on or the designer has already marked one.
3. **Design.** Version checkpoint, then high fidelity in Figma on the Design Studio page with library components and
   variables, one frame per screen and state. Screenshots after each screen.
4. **Review.** The design system check, then the chosen preset, then its fix rounds. The run ends with a summary:
   what was built, what passed, what is left, tokens used, and links to the frames and the checkpoint.

## Commands

| Command | What Claude does |
| --- | --- |
| `/design <brief>` | The full plan, sketch, design, review run |
| `/sketch <brief>` | Plan and sketch only |
| `/review <frame> [preset]` | Review existing frames with the chosen preset, findings as Figma comments pinned to nodes, no edits |
| `/audit` | The design system check across the whole file, grouped by area, with a fix offer per group |
| `/prototype <frame>` | HTML prototype in the chat folder, shown in Preview, `html_to_figma` back to the file on request |
| `/flow <description>` | FigJam user flow via `generate_diagram` |
| `/handoff <frame>` | Asset exports, specs, Code Connect coverage, a Linear ticket draft |
| `/system` | Rebuild the design system profile and show what changed |

## Build phases

### 0. Spike (2 days)

- Remote Figma MCP from the Agent SDK with OAuth. `use_figma` creates a frame, imports a library component by key and
  binds a color variable. What the calls look like in the transcript.
- `saveVersionHistoryAsync` through `use_figma`, and whether a PreToolUse hook can run it before the first write.
- Moving the Figma tab to a node: changing `node-id` in the URL without reloading the editor, or another way.
- Claude writing Excalidraw JSON: quality of three wireframe directions for a two-screen brief.
- The REST API node data: does it carry bound variables, text styles and component keys for every rule in the check.
- Each preset on one five-screen design: time, tokens and findings, so the default is chosen on numbers.

Output: `SPIKE.md` with answers and any decision above that changes.

### 1. Skeleton and theme (1 week)

- Copy AgentView, rename packages, `~/.designstudio`, the menu bar app id, ports :7778 and :5174 so both apps can run.
- Remove git, GitHub, deploy, worktrees, Observe and the repo Explorer.
- Light theme and the type scale: replace the hard-coded font sizes with the six tokens, then raise row heights and
  icon sizes to match.
- Workspace is Figma files. New chat takes a Figma URL or a file from the sidebar, creates the chat folder and starts
  the session with the Figma MCP and the designer system prompt.
- Figma tab: Browser pane pinned to the file, follow nodes from `set_status`.
- Settings: Figma token, default team, "Stop after sketch" default.

### 2. Plan, sketch, design (1 week)

- Phase engine: rework `loop.ts` phases to plan, sketch, design, review with the phase stepper in the task box.
  Opus 5.5 for plan, Sonnet 5.5 from sketch onwards.
- Sketch page: Excalidraw, sketch files in the chat folder, live reload when Claude writes, "Use this", copy to Figma.
- Design system profile builder and the Design System sidebar.
- Version checkpoint hook, Design Studio page rule, before and after screenshots, per-turn change log.

### 3. Review (1 week)

- Design system check on the server from REST node data, with unit tests per rule.
- One combined reviewer prompt and six area prompts, sharing the profile, the brief and screenshots from the chat
  folder. The server runs them as separate `query()` calls so Focused and Full run in parallel.
- Findings schema, merge, fix rounds, re-review of failed areas, preset menu, token count per run.
- Review page and Figma comments for `/review`.

### 4. Commands, comments, phone (1 week)

- Remaining commands, Comments page with reply and "Ask Claude", Preview tab, Handoff.
- Phone pass for Sketch drawing and Review.

### 5. Pilot

Two or three designers for two weeks. Measure how often they stop after sketch, how often they restore a checkpoint,
which preset they settle on, which findings they ignore, and the tokens per `/design` run. Fix the top three problems before widening.

## Risks

- **Figma write tools are beta.** Names, behavior and pricing may change. Keep Figma tool names in one place
  (`shared/figma.ts`). `/review`, `/audit`, `/sketch` and `/flow` stay useful without writes.
- **Chrome relay friction.** Chrome turns off remote debugging on every restart and the designer has to tick it again,
  and the relay needs Full Disk Access once. Fine for a pilot. Before a wider rollout, look at a Chrome extension
  instead of remote debugging.
- **Review cost.** Full runs six reviewers per round and can still be expensive. It is opt-in; the default is one
  reviewer and the rule check costs no tokens. Screenshots are shared, findings per reviewer are capped, and only
  failed areas re-run.
- **Sonnet quality on design.** Sonnet may produce weaker layouts than Opus on complex screens. The Opus plan lists
  screens, states and components per screen, which narrows what Sonnet has to decide. The pilot compares results on
  real briefs, and the design system check catches token and component mistakes regardless of the model.
- **No programmatic undo.** Checkpoints, the Design Studio page and the change log are the safety net. Say so the first
  time a chat writes to a file.
- **Sketch to design gap.** Excalidraw sketches do not know the design system. The plan lists components per screen
  so the design phase maps sketch boxes to real components; the Brief reviewer checks the result against the sketch.
- **Seats.** Writes outside drafts need a Full seat. Show the seat from `whoami` in the sidebar.

## Out of scope for now

Figma Make files, Weave tools, shaders and generative plugins, multi-user chats, a dark theme.
