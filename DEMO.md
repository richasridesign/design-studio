# Design Studio demo guide

Open http://localhost:5174 on the Mac, or scan the phone icon's QR code to open it on your phone and add it to the home
screen. DesignStudio.app runs from the menu bar (started by `./start.sh`). This guide shows the app after the redesign.

Nothing in the tour spends tokens. Do not send anything while you follow it.

## Ten-minute tour

1. **Open the app.** Go to the URL.
   You should see: The top bar, the left rail and the conversation. With no file and no content, the canvas column is
   hidden and the conversation fills the window. If the Figma token or tools are missing, a one-line "Figma is not
   connected yet" banner shows.

2. **Chats and the Sample tour.** In the Chats panel, click the pinned "Sample tour" row.
   You should see: The read-only chat "Grocery app (sample)". The Figma, Sketch and Review tabs appear above the canvas.

3. **The review card.** At the top of the sample conversation, find the review card.
   You should see: The card shows the run ("Review 1 · Full"), blocking and major counts, tokens, a pass or fail mark
   per area, and the buttons Open Review and Post as Figma comments (do not click it). Review deeper appears only after
   a Quick review or an audit. In a chat with history, each reply has an "n steps" row that expands into the tool calls.

4. **Review tab.** Open Review. Click the Crit row, then the Copy row.
   You should see: One list, newest first, one line per run (kind, time, counts, tokens). The newest is open. Crit
   shows four viewpoints. Copy shows suggested text changes, each with an edit field and a tick.

5. **Sketch tab.** Open Sketch.
   You should see: Low-fidelity directions per screen on an Excalidraw canvas. You can draw and add notes here.

6. **File panel.** Click File in the left rail. Open and close Comments and Versions.
   You should see: The frames list, then the two collapsible sections. They remember whether they are open.

7. **Design system panel.** Click the design system icon. Open "Export tokens". Scroll to Rules and open it.
   You should see: Colors, text styles, spacing and components. Export offers CSS, Tailwind and W3C JSON. Rules lists
   house rules for "This file" and "All files".

8. **Mode pill and Shift+Tab.** Click the pill at the left of the composer, pick Design, then open the menu again.
   Press Shift+Tab in the composer until you are back on Chat.
   You should see: The menu lists Chat, Design and Review. In Design, "Stop after sketch" and "Review depth" (Quick or
   Full) appear and the composer gets a coral ring.

9. **Attach popover and link chip.** In Chats, click New chat. Click "Attach Figma file" in the top bar (or press
   Cmd+O), then close it. Paste a figma.com design link in the composer. Clear the text. Do not click Attach.
   You should see: The popover has a link field and a Recent files list. The chip "Attach <name>?" has an Attach button.

10. **Slash commands.** Type `/`. Then type `/sta` and press Tab. Clear the text.
   You should see: The six recipes first, then the server commands. Tab expands the recipe into its full prompt.

11. **Settings and Check setup.** Click the gear. Click "Run all checks" in Check setup. Press Escape.
   You should see: Settings opens as an overlay. Check setup tests the Figma token, Figma tools, Chrome and the Claude
   login, and says ok or what is wrong, with a fix button where one exists.

12. **Phone QR.** Click the phone icon in the top bar. Scan the code with your phone camera.
   You should see: A QR code with a switch between the Tailscale and Wi-Fi addresses, and how to add the app to the
   home screen.

Also worth a look: press `?` for the shortcut sheet, and press Cmd+Shift+P for the command palette.

## If something looks different

- No Figma, Sketch or Review tab: the chat has no file, sketches or review yet. Open the Sample tour, or press Cmd+1 to
  Cmd+3 to bring a tab back.
- No Preview or Files tab, terminal or build check: turn on "Developer tools" in Settings.
- Cmd+digit does nothing: Chrome keeps some of them, so use Ctrl+digit.
- The top bar status is hidden on wide screens. The conversation status line shows it there.

## What changed in the redesign

- R1, Modes: a plain message is a normal chat. The composer pill picks Chat, Design or Review, and Shift+Tab cycles.
- R2, Attach a Figma file: a chat starts without a file. Attach from the top bar, Cmd+O, or the composer link chip.
- R3, Run card: the Plan, Sketch, Design, Review stepper is replaced by a card in the conversation with Stop.
- R4, One conversation view: Timeline and Transcript are merged, with an "n steps" row per reply.
- R5, No Home tab: a short welcome with four suggestions, a setup banner and the sample tour row in Chats.
- R6, Tabs only with content: Figma, Sketch and Review show when they have something. Settings is an overlay.
- R7, Six recipes as slash commands: `/brief`, `/states`, `/responsive`, `/crit`, `/copy`, `/handoff`.
- R8, Review as one list: no Review, Crit, Copy, Changes and Build sub-tabs, and no Check or Focused presets.
- R9, Review card in the conversation: counts, area marks, Open Review, Post as Figma comments, Review deeper.
- R10, Free check after edits: in Chat mode, a turn that edited Figma gets the design system check on its frames.
- R11, Three left panels: Chats, File (Comments and Versions inside) and Design system (Rules inside).
- R12, Theme pass: one type scale, serif only for titles, no model names in the UI, no shadows except popovers.
- R13, Cuts: the FlowBar, the New chat dialog and brief templates, the focus pill, the Preview tab, and ten recipes.

## Feature reference

**Look and feel.** Cream paper background and coral accent, with Figma blue for Figma things (node chips, focused
frames, the Figma tab). Type is 16 body, 14 secondary and 13 labels. The system serif (New York) is used for the
wordmark, page titles and headings in Claude's replies. The home screen icon is coral.

**Modes.** Chat is a normal conversation with Sonnet. Design runs plan (Opus), sketch, design and review. Review checks
frames and edits nothing. Design options (stop after sketch, review depth) are in the pill menu. Settings also has
"Stop after sketch" and a default review depth.

**Design run.** Plan writes a brief. Sketch draws two or three directions per screen. Design builds the screens on a
page named Design Studio with your library components, variables and text styles. Review runs the free design system
check, then reviewers by depth: Quick is one reviewer, Full is six area reviewers with up to two fix rounds. Before
its first change in each turn, Claude saves a Figma version, and a hook blocks changes until it has.

**Attach and Figma access.** The Figma token gives file lists, frames, thumbnails, comments and the design system
check. "Add Figma to Claude" in Settings adds the Figma MCP server. The Figma tab shows your own Chrome through the
relay on :7780. Check setup tests the token, tools, Chrome and Claude login without spending tokens.

**Conversation.** Each turn shows progress lines with frame thumbnails (click one to jump to it in Figma), notes and
the reply. Read aloud is in the status line. You can paste, drop or attach up to five images in the composer. They are
saved to `refs/` in the chat folder and sent with the message.

**Review, crit and copy.** `/review` runs reviewers and the free check. `/audit` checks the whole file with no model
calls. `/crit` gives four viewpoints with a verdict and notes. `/copy tone:friendly` suggests text changes, and
"Apply selected in Figma" puts a precise prompt in the composer. Crit and copy are one Sonnet call each (a few cents)
and never edit Figma. The Review tab can post findings as Figma comments.

**Build check.** With developer tools on, `/buildcheck <url> <frame link>` opens the URL in a hidden Chrome tab at the
frame's width, screenshots it, renders the Figma frame, and one Sonnet call lists the differences with a match score.
View by slider or side by side. "Send diffs to engineer" copies a markdown checklist.

**File panel.** Frames (select one to target recipes), Comments with Show in Figma, Reply and Ask Claude ("Ask Claude
to address all open comments" does the list, since Figma's API cannot resolve comments), and Versions with Claude's
checkpoints marked and a compare view.

**Design system and Rules.** The profile can be rebuilt with `/system`. "Export tokens" gives CSS variables, a
Tailwind theme or W3C JSON. Rules for "This file" and "All files" reach every chat on the next message, and the
reviewers and crit check against them. "Suggest rules from my design system" proposes some.

**Recipes.** Six built-in recipes expand from `/`. Your own recipes show as `/<title>`, and you manage them in the
palette ("Recipe: Save composer text as recipe", "Recipe: Edit ...").

**Spend meter.** The pill shows chat cost by phase and model, today's total, and a budget bar. The daily budget is in
Settings. Background reviewers and profile builds count. Chat spend survives a server restart.

**Design report.** Review tab, "Export report" (or the palette). One self-contained HTML file with the brief, sketches,
frames, review, crit and copy changes. No external requests, prints cleanly.

**Shortcuts and focus mode.** Press `?` for the sheet. Cmd+1 to Cmd+5 open Figma, Sketch, Review, Preview and
Settings (Ctrl if Chrome keeps the digits). Cmd+B toggles the sidebar and Cmd+. toggles focus mode, which hides both
side panels. Node ids show as Figma-blue chips.

**Sample tour.** Read-only chat with a finished brief, sketches, a full review, a crit, a copy pass, a review card and
a design system profile. It never calls Claude or Figma.

**Phone.** The phone icon shows a QR code for the Tailscale or Wi-Fi address and how to add the app to the home screen.
Everything except the Figma tab works on the phone.

**Security.** The server rejects POSTs and WebSockets from other websites (Origin and Host checks; localhost, LAN,
Tailscale and Netbird stay allowed). Before this fix, any page you visited could write house rules or settings. The
report embeds sketches as images and sends a strict CSP. Uploads are checked by their bytes, request bodies are capped
at 1 MB and rules at 20 KB. The sample chat is read-only on every path.

**Chats without a file.** All chats with no Figma file attached sit in one "No file yet" group in Chats. Its + button
starts another new chat.

**Phone layout.** At phone width the top bar keeps the file name, spend pill, MCP dot, notifications and Settings; the
idle status and the phone QR button are hidden. The bottom bar reads Chat, Figma, Sketch, Review, More (Figma, Sketch
and Review only when they have content), and the duplicate tab strip above the canvas is hidden.

**Reviewer progress.** During a design run's review phase, the run card lists each reviewer under the Review row: the
design system check first, then each area (or "All areas" for Quick), with a spinner while it runs and a pass, fail or
"failed" mark when it ends.

**Attach from Chrome.** The attach popover lists Figma files open in Chrome ("Open in Chrome", newest first, one per
file) above Recent files. Click one to attach it. It needs the Chrome relay connected.

**Design run without a file.** A design run in a chat with no Figma file pauses before the design phase instead of
stopping. The run card says "Waiting for a Figma file" and has an "Attach Figma file" button; attaching a file resumes
the run. Stop ends it.

**Copy tones.** Type `/copy` in the composer to see three rows: `/copy` (friendly), `/copy tone:formal` and
`/copy tone:neutral`. Pick one with Tab or a click; it fills in the command with the selected frames.

**Free check on nested edits.** When Claude edits a layer inside a frame (a text node, a button), the free check after
the turn finds the top-level frame that holds it with one Figma REST call and checks only that frame. Before, a nested
edit made it check the whole file. Try it with real-run step 2: ask for a text change inside one frame, and the review
card lists only that frame.

**Welcome suggestions.** An empty chat's suggestion chips follow the file state. With no file, the first chip is
"Attach a Figma file" and opens the attach popover. With a file attached, the chips name the file and the selected frame.

**Frame autocomplete.** With a file attached, type `#` in the composer to list the file's top-level frames with their
page; keep typing to filter by name. Tab or a click inserts "Name (frame link)", the same form recipes and `/review`
read. The idle hint under the composer says "# for frames" when a file is attached. Each row shows a small
thumbnail of the frame, rendered by Figma and cached, so frames with similar names are easy to tell apart.
With nothing typed after `#`, frames Claude worked on in this chat come first, most recent at the top.
In a chat without a file, `#` shows one row, "Attach a Figma file to list its frames", which opens the attach popover.

**Copy review as checklist.** A review card with findings has "Copy as checklist". It copies a Markdown checklist,
blocking issues first, each line with the layer, the rule, the fix and a link to the node in Figma. Paste it into a
ticket or a Figma comment. Try it on the review card in the sample tour (the sample has no real file, so no links).
The same button is in the Review pane, next to "Post as Figma comments" on the selected review run.

**Stale review hint.** When the Figma file was saved after the newest review in a chat, that review card says "File
changed since this review" with "Check again", which puts `/review check <frame ids>` in the composer (free, no model
tokens). The app reads the file's last-modified time at most once a minute. Not shown in the sample tour.

**Chat search.** The Chats panel has a "Search chats" box under New chat. It matches file names (the whole group
stays) and chat titles, and lists every matching recent chat instead of the last five. Escape clears it.

**Drafts per chat.** Unsent text in the composer stays with its chat: switch to another chat and back, and the draft
is still there. Drafts live in memory only and go away on reload. A new chat that was never sent closes when you leave
it, and its draft goes with it.

**Jump to findings.** On a review card, failed areas are links. Click one (or Tab to it and press Enter) to open the
Review pane on that run with the area's card expanded, outlined and scrolled into view. Try Typography on the sample
tour's review card.

**Phone check of the newer features.** At 390px wide: review card links jump to the Review pane, chat search sits under
New chat in More, Chats, and `#` rows cut long frame names short so the page name stays visible.

**Copy crit and copy-pass results.** In the Review pane, a crit run has "Copy notes" (the summary, then each viewpoint
with its verdict and labelled points) and a copy pass has "Copy as table" (a Markdown table of before, after and
reason). Both work on the sample tour's crit and copy runs.

**Link from another file.** In a chat that already has a file, paste a Figma link to a different file and the composer
shows "Open <name> in its own chat?". Open switches to that file's chat (it reuses one if it exists) and moves the
typed text there. Untested with a real second file so far.

**Frame names in the chat.** Figma frame links in your messages show as a chip with the frame's name; click it to
open the frame. Review cards list the reviewed frames by name under the title (three, then "+n more"). Names come from
one outline request shared by the whole page and refreshed at most once a minute; without it, ids show instead.
The frame names on review cards and in the Review pane run summary are links that open the frame.
In Claude's replies, a bare Figma frame link shows as the same chip, and any Figma frame link opens the frame in the
app instead of a new browser tab.

**Retry a failed review.** When a reviewer failed (timeout, tool error), its row says "failed" and the review card gets
"Retry", which puts `/review <same preset> <same frames>` in the composer for you to send.

**One outline request.** The Files panel, `#` frames, recipes, review cards, Changes and Build check share one cached
copy of the file outline, so a page makes at most one Figma outline call per file per minute. A frame Claude just added
can take up to a minute to show in those lists, or click the refresh button next to Show in Chrome in the File
panel to reload it everywhere at once.

**Error boundaries.** If the chat column, a canvas tab or a sidebar panel hits a render error, only that area shows
"This panel hit an error" with the message and a Reload button; the rest of the app keeps working. Events that name an
unknown sidebar view are ignored instead of blanking the page.

**Sample frame names.** The sample tour's file lists two frames, Cart and Empty cart, so review cards, the Review pane,
the File panel and `#` show names instead of ids in the tour.

## After the tour: real runs

These spend tokens and need a Figma token, Claude's Figma tools and a file you can edit. Use a scratch file.

1. **Attach a file.** Click "Attach Figma file", paste a link, send a plain question such as "What frames are on this
   page?". You should see a normal reply with an "n steps" row.
2. **Free check after an edit.** In Chat mode, ask Claude to change one frame. When the reply ends, the status line shows
   "Checking edited frames" and a review card follows. This check uses no model tokens.
3. **Review mode.** Switch to Review with Shift+Tab, name a frame and send. Reviewers run and a review card appears.
   Click Review deeper to put `/review full` in the composer.
4. **Design mode.** Switch to Design, send a short brief. The run card shows plan, sketch, design and review. Turn on
   "Stop after sketch" first if you want to pick a direction before Claude touches Figma.
5. **Crit and copy.** Type `/crit` or `/copy tone:friendly` with a frame link. Each is one Sonnet call, a few cents.
6. **Spend.** Click the spend pill to see the cost by phase and model.

## Open questions for you

- AgentView has the same cross-site request gap that Design Studio fixed (Origin and Host checks). Port the fix there?
- Not tried with real Figma and Claude yet. These need a Figma token and spend a few cents each:
  - Comments inbox, crit, copy pass, Versions compare, build check and image paste.
  - The attach flow with a real file (top bar, link chip, Cmd+O).
  - The free check after Claude edits Figma in Chat mode.
  - The review card after a real review.
  - Design mode end to end, with the run card.
