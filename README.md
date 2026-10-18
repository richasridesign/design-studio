# Design Studio

A web UI for designing in Figma with Claude, built on the Claude Agent SDK.

You chat with Claude by default. Attach a Figma file and Claude can read and edit it, using your design system.
Switch the composer to Design mode for a full plan, sketch, design and review run, or to Review mode to check frames.

## Run

```bash
npm install
./start.sh
```

`start.sh` builds and opens `dist/DesignStudio.app`, a menu bar app that runs the server on :7778, the web app on :5174
and a Chrome relay on :7780. It uses the Claude Code CLI you have installed and its login.

| Command | |
| --- | --- |
| `npm run serve` | Server and web app without the menu bar app |
| `npm test` | Unit tests |
| `npm run typecheck` | Type checks for server and web |

## Setup

Open Settings (the gear in the top bar). "Check setup" tests each item below without spending tokens and offers a fix
button where one exists.

1. **Figma token.** Add a Figma personal access token with read access to files and write access to comments.
   Design Studio uses it for the file list, frames, thumbnails, the design system check and comments.
2. **Claude's Figma tools.** Design Studio uses the official Figma plugin for Claude Code (`figma@claude-plugins-official`),
   the same connection and sign-in as the Claude CLI. "Add Figma plugin" installs it. Sign in once: run `claude`, type
   `/mcp`, pick plugin:figma:figma and authenticate.
3. **Chrome.** The Figma tab shows your own Chrome, where you are logged in to Figma. Click Connect Chrome there and
   allow remote debugging. Give DesignStudio.app Full Disk Access once. The relay reads Chrome's DevToolsActivePort
   file, which macOS protects. The web page and your phone never need this permission.

If the token or the Figma tools are missing, a new chat shows a one-line banner.

## Modes

The pill at the left of the composer sets the mode. Shift+Tab cycles Chat, Design and Review.

| Mode | What a message does |
| --- | --- |
| Chat (default) | A normal conversation with Claude (Sonnet 5.5). With a Figma file attached, Claude can read and edit it |
| Design | Opus 5.5 plans, Sonnet 5.5 sketches and designs, then reviewers check the result |
| Review | Reviewers check the frames you name or the attached file. Nothing is edited |

Design mode adds options to the pill menu: "Stop after sketch" waits for you to pick a direction, and "Review depth"
is Quick or Full. The composer gets a dark outline in Design mode (light in the dark theme) and a grey one in Review mode.

## Attach a Figma file

A chat does not need a Figma file to start. Attach one when you need it:

- Click "Attach Figma file" in the top bar (or press Cmd+O), paste a link or pick a recent file.
- Or paste a figma.com link in the composer and click Attach on the chip that appears.
- In a chat that already has a file, a link to another file offers to open that file in its own chat.

Claude gets the file on its next turn. Chats without a file are grouped under "No file yet" in Chats. "Search chats"
filters by file name and chat title, and unsent text stays with its chat when you switch.

## The conversation

Each turn shows your message, Claude's progress lines (with frame thumbnails), notes and the reply. All tool calls of
a turn sit in one collapsed "n steps" row with the total time. Click it to see every step. Figma frame links, yours
and Claude's, show as chips with the frame name and open the frame on click.

- **Run card.** In Design mode, a card at the end of the conversation shows each phase (plan, sketch, design,
  review) as done, now or to come, with tokens so far and a Stop button. While Claude waits for your sketch pick,
  the button is Open Sketch.
- **Review card.** When a review or audit finishes, a card shows blocking and major counts, tokens, the frames by
  name and a pass or fail mark per area. Failed areas link to their findings in the Review pane. Buttons: Open
  Review, Copy as checklist (Markdown), Post as Figma comments, Retry (when a reviewer failed) and Review deeper
  (after a Quick review or audit). If the file was saved after the newest review, the card offers Check again.
- **Free check after edits.** In Chat mode, when a turn edited Figma, Design Studio runs the design system check on the
  frames Claude touched (a nested layer counts as its top-level frame) and posts a review card. It uses no model tokens. Turn it off in Settings, Design runs.

Before its first change in each turn, Claude saves a Figma version. A hook blocks changes until it has.

## Slash commands and recipes

Type `/` in the composer for the list. Recipes come first. Tab or Enter on a recipe expands it into its full prompt,
which you can edit before sending. If a frame is selected in the File panel, the prompt names it.

| Recipe | What it does |
| --- | --- |
| `/brief` | Switch to Design mode and write the brief |
| `/states` | Add empty, loading, error, long content and no permission variants |
| `/responsive` | Create 390, 834 and 1440 wide versions with auto layout |
| `/crit` | Four-viewpoint critique, no edits (one Sonnet call) |
| `/copy` | Suggest clearer, shorter, consistent UI text (one Sonnet call) |
| `/handoff` | Developer notes with spacing, tokens, props and interactions |

`/copy` also lists `/copy tone:formal` and `/copy tone:neutral`. Type `#` for the attached file's frames (with
thumbnails, the frames Claude edited first) and `@` for files in the chat folder. Press `?` for all keys.

Your own recipes show as `/<title>`. Save one from the command palette ("Recipe: Save composer text as recipe",
`{frames}` stands for the selected frame) and change it with "Recipe: Edit ...".

These commands run on the server:

| Command | What it does |
| --- | --- |
| `/design <brief>` | The full run: plan, sketch, design, review |
| `/sketch <brief>` | Plan and sketch only |
| `/review [quick\|full] [frame links]` | Review frames without changing them |
| `/audit` | Design system check across the whole file, no model calls |
| `/system` | Rebuild the design system profile |
| `/crit [frame links]` | Same as the recipe, with frame links |
| `/copy [tone:friendly] [frame links]` | Tones are friendly, neutral and formal |
| `/buildcheck <url> <frame link>` | Compare a live page screenshot with a Figma frame (dev tools on) |

## Panels and tabs

The left rail has three panels. Cmd+B hides it. Cmd+. (focus mode) hides both side panels.

- **Chats.** Chats grouped by Figma file, with the pinned "Sample tour" row.
- **File.** The file's frames (select one to target recipes and commands) with collapsible Comments and Versions
  sections. Comments list Figma threads, open first, each with Show in Figma, Reply and Ask Claude. Versions list
  Figma versions with Claude's checkpoints marked, and compare one with now by slider or side by side.
- **Design system.** The profile of colors, text styles, spacing, radius and components. "Export tokens" gives CSS
  variables, a Tailwind theme or W3C design tokens JSON. The Rules section holds house rules for "This file" and
  "All files". Claude gets them in every chat, and the reviewers and crit check against them.

The canvas tabs Figma, Sketch and Review appear only when the chat has a file, sketches or a review. With none, the
conversation fills the window. The Sketch tab is an Excalidraw canvas: Claude draws two or three directions per
screen, and you can draw and write notes that Claude reads before it designs. Settings opens as an overlay (Escape
closes it). The Preview and Files tabs, a terminal and the build check show when "Developer tools" is on in Settings.

## Review tab

One list of every review, audit, crit and copy pass, newest first, one line each (kind, time, counts, tokens). The
newest is open. Click a row to expand it. The Review button puts `/review` in the composer, next to Quick and Full.

- Review and audit rows show the frames by name, findings per area, tokens per reviewer, Post as Figma comments and
  Copy as checklist.
- Crit rows show four viewpoints (new user, power user, accessibility, product) with a verdict and linked notes, and Copy notes.
- Copy rows show suggested text changes with a reason each. Edit or untick, then "Apply selected in Figma" fills the
  composer. Copy as table gives a Markdown table of the changes.

"Export report" saves one self-contained HTML file with the brief, sketches, frames, review, crit and copy changes.
It makes no external requests and prints cleanly. Node ids show as Figma-blue chips.

## Cost

Opus 5.5 plans in Design mode. Sonnet 5.5 does everything else. Crit, copy and build check are single Sonnet calls.

The spend pill in the top bar shows what the chat has cost, split by phase and model, with today's total. Set a daily
budget in Settings; the pill turns amber at 80% and red past 100%. The daily total is kept in
`~/.designstudio/spend.json`, and each chat's spend in its chat folder.

These use no tokens: `/audit`, the free check after edits, the sample tour, token export, version compare, the
report export and Check setup.

## Sample tour

The "Sample tour" row in Chats opens a read-only chat, "Grocery app (sample)", with a finished brief, sketches, a full
review, a crit, a copy pass, a review card and a design system profile. It never calls Claude or Figma. Sending a
message, steering or running a command there only shows a note.

## Phone

Click the phone icon in the top bar for a QR code (Tailscale or Wi-Fi address), or open `http://<mac>:5174` over the
LAN, Tailscale or Netbird, then add it to the home screen. The Mac must be awake and DesignStudio.app running.

Everything except the Figma tab works on the phone. The Figma tab shows the Mac's Chrome, so use it on the Mac.

## Security

The server checks the Origin of every POST and WebSocket and the Host of every request. It allows localhost
(`127.0.0.1`, `[::1]`), `.local` names, `.ts.net` (Tailscale), `.netbird.cloud`, and private addresses: 10.x,
172.16-31.x, 192.168.x and the Tailscale range 100.64-127.x. Other websites cannot write settings or rules through
your browser. Uploads are checked by their bytes, request bodies are capped at 1 MB and rules at 20 KB. The report
embeds sketches as images and sends a strict CSP.

## Keyboard

Press `?` for the sheet. Chrome may keep Cmd+digit; use Ctrl then.

| Keys | Action |
| --- | --- |
| Shift+Tab | Cycle the composer mode |
| Cmd+Shift+P or F1 | Command palette |
| Cmd+O | Attach a Figma file |
| Cmd+B | Toggle sidebar |
| Cmd+. | Toggle focus mode |
| Cmd+J | Toggle terminal (dev tools) |
| Cmd+1 to Cmd+5 | Figma, Sketch, Review, Preview, Settings |
| `/` | Focus the composer |
| `?` | Show the shortcut sheet |
| Enter, Shift+Enter | Send, new line |
| Up | Previous message |
| Tab | Accept a suggestion or expand a recipe |
| `y`, `a`, `n` | Permission card: allow, always allow, deny |

## Where things live

Each Figma file gets a folder under `~/Design Studio` with the plan, sketches, the design system profile, review
results and reference images. Settings are in `~/.designstudio/settings.json`.

