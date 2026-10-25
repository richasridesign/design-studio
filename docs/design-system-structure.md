# Design system and principles: structure (draft)

Draft 2, 25 Oct 2026. This is the frame Design Studio will support. What goes inside each part is Richa's call: every item below is a slot, not content. Examples in *italics* come from the Example app file.

Sources for the structure:
- Elastic UI docs (eui.elastic.co/docs): Getting started, Components by category, Patterns, Content, Utilities, Data visualization. Each component page has types, style, states, labels, usage and props.
- GOV.UK Government design principles (gov.uk/guidance/government-design-principles): 11 principles.

## 1. Base and overrides

| Part | Base (all projects) | Project override (e.g. *Example app*) |
|---|---|---|
| Design principles | GOV.UK 11 plus Richa's own | Add a principle, or reword one for this product |
| Guidelines | The six skills in ~/design-skills | Add or replace a rule for this project only |
| Design system | None | Each project has its own (read from its Figma file) |

A project shows the base with its overrides on top, and marks which lines are overrides.

## 2. Design principles (base)

### 2.1 GOV.UK, all 11 kept

Each one lists the rules in Richa's skills that already follow it.

| # | Principle | In one line | Richa's rules that match |
|---|---|---|---|
| 1 | Start with user needs | Find real needs through research and data, not assumptions | Think as a principal UX designer: who is the user now, what do they already have. Decision 1 says what the viewer can do with a new element |
| 2 | Do less | Reuse what works; build only what only we can build | Build from existing components; extend a set with a variant before making a new one; never duplicate |
| 3 | Design with data | Decide from real behaviour, keep measuring after launch | None yet |
| 4 | Do the hard work to make it simple | Simple to use takes more effort than simple to look at | Subtext one line; one idea per subtext; routine actions as quiet links; cut repeated words |
| 5 | Iterate. Then iterate again | Start small, test, refine or drop | Iterate, never replace: new versions beside old ones, old ones frozen; parked features kept, not deleted |
| 6 | This is for everyone | Inclusive and accessible from the start | WCAG 2.2 AA; never colour alone; they/them for sample people |
| 7 | Understand context | People, devices and situations, not screens | First-time admin gets the prebuilt path first; custom creation after the first win |
| 8 | Build digital services, not websites | Design the whole service, end to end | Every step has its states (typing, error, wait, done); flows walk end to end inside one version; arrows into every screen |
| 9 | Be consistent, not uniform | Shared language and patterns, flexible where needed | Same component, same variant everywhere; fix it once in the master; keep the product's own terms |
| 10 | Make things open | Share designs, ideas and failures | Decision stickies with the why; dated notes and changelogs |
| 11 | Minimise environmental impact | Keep energy and material use low over the whole life | None yet |

### 2.2 Richa's own (rules that match no GOV.UK principle)

| # | Principle | In one line | Comes from |
|---|---|---|---|
| R1 | Plan before you build | List screens, steps, buttons and copy, and agree them before changing anything | Plan before change; interaction first; never change an established component without approval |
| R2 | Calm and clear | Hierarchy and whitespace over boxes; colour only when it means something | Calm, Scandinavian style; red means error only; shadows only where they carry meaning; no fill on wrappers |
| R3 | Honest about what the AI does | Never promise more than the product delivers; say who did what and where it came from | Don't promise more in banners or labels; "Atlas wrote 4, you added 2"; AI acts only where approved |
| R4 | Say exactly what happens | Labels name the exact thing; waits say how long and what comes next | Buttons name the next screen; errors say what, meanwhile, who acts; arrow labels name one control |

Format per principle: **Title**, **Means** (one line), **In this product** (one line, project override).

## 3. Design system (per project)

Five parts, in Elastic UI's order.

### 3.1 Foundations

| Slot | Holds | Today in Design Studio |
|---|---|---|
| Colour | Tokens by role (text, icon, surface, border, action, status, accent), light mode | Yes (57 read from Figma) |
| Typography | Text styles and the type scale | Yes (8) |
| Spacing and sizing | Spacing scale, control heights (*36px toolbar*) | Partly |
| Grid and layout | Columns, gutters, breakpoints, page widths (*12 columns, side sheet 440*) | No |
| Radius and borders | Radius scale, border widths and when to use each | Partly |
| Elevation | Shadows and when each one is allowed | No |
| Iconography | Icon set, stroke, sizes, colour rules (*Lucide, 1.5 stroke*) | No |
| Motion | Durations, easing, reduced motion | No |

### 3.2 Components

Elastic UI's categories, filled with the 75 component sets in Example app. Two categories are added for what Elastic doesn't have (AI, Design file). Elastic's Data grid and Editors and syntax have nothing in Example app yet, so they stay empty.

| Category | *Example app components* |
|---|---|
| Layout | *Page header, Footer note, line (divider)* |
| Containers | *card new, Colleague card, Choice card, Directory card, Change card, Request card, card stat, Attention item, Dialog, Side sheet, accordion* |
| Navigation | *button, Icon button, History button, Text link, Breadcrumb, Side nav, nav item, Page tab, Segment, Workflow header actions, Connectors menu, Filter menu* |
| Display | *Tag, Count, Avatar, ellipse profile, App logo · 12, App tile, Toast, Info banner, Tooltip, Info tooltip, Tab tooltip, progress bar 2, Path stage, Path to live, timline item, Connected to, Who can use it* |
| Forms | *Input, Search, Toggle, chip, Persona select, Persona option, Access option* |
| Tables and lists | *table cell, Workflow table header, Workflow row, Connector row, Connector table row, Monitor row, Audit row, Guardrail row, Action log item* |
| AI (added) | *message item new, chat composer, Suggestion chip, Answer actions, Trace card, Trace tag* |
| Templates | *None as components yet (candidates: Connectors page, HRIS details page)* |
| Design file (added, not product UI) | *Flow note, Decision sticky* |
| Icons | *circle-dollar-sign, monitor-cog, send-horizontal, square-check, user-cog* (move under Iconography) |
| Deprecated | *Button (deprecated), Message Item (old)* (listed so nobody uses them) |

Each component gets one page with these 10 headings (from Elastic UI's Button page, plus Figma). A heading with nothing to say is hidden.

1. **Overview:** what it is, when to use it, when not to.
2. **Types:** the variants (*Primary, Secondary, Ghost, Destructive*).
3. **Style:** colour and meaning, size, width.
4. **States:** default, hover, focus, pressed, disabled, loading, error.
5. **Content:** label rules, preferred words, words to avoid.
6. **Usage:** combining, placement and order (*one primary per screen*).
7. **Accessibility:** name, role, keyboard, focus, contrast.
8. **Do and don't:** pairs with a screenshot each.
9. **In Figma:** component set link, variant keys, Hover variant per state.
10. **Changelog:** dated changes.

### 3.3 Patterns

Elastic UI's patterns first, then Example app's.

| From | Pattern | Covers |
|---|---|---|
| Elastic | Error messages | What is wrong, what happens meanwhile, who acts |
| Elastic | Help content | Tooltips, helper text, "Source:" links |
| Elastic | Save buttons | Save, unsaved changes, leave without saving |
| Elastic | Health and severity | Status colours and shapes, what each means |
| Elastic | Tables | Columns, alignment, row actions, empty cells (N/A) |
| Elastic | Nested drag and drop | Reordering |
| Example app | Forms | Empty, typing, filled, invalid, submitting, done |
| Example app | Empty states | First use, nothing found |
| Example app | Waits and progress | Duration, what happens next |
| Example app | Destructive actions | Confirm, impact, undo (*Disconnect HRIS*) |
| Example app | Approvals and AI access | Read-only by default, approving write access per workflow |
| Example app | Chat side panel | Modes, threads per tab, chips and typed replies |
| Example app | Connect an app | Who sets it up, invite an admin, blocked by an admin |

Each pattern page: problem, solution, the components it uses, a reference screen in Figma, do and don't.

### 3.4 Content

Elastic UI's Content sections, plus two for this product.

| Slot | Holds |
|---|---|
| Voice and style | Who the product sounds like |
| Tone | How it shifts (error, success, waiting) |
| Language | Grammar, punctuation (*no em dashes*), capitalisation |
| Accessibility | Writing for screen readers, link text |
| Inclusivity | Pronouns (*they/them for sample people*), names |
| Word choice | Preferred words, words to avoid |
| Glossary (added) | Product terms that never change (*AOP, Evals, Atlas*) |
| Sample data (added) | Placeholder people and data (*Arya Dsouza*) |

### 3.5 Data visualisation

Kept: projects will need charts and metrics.

| Slot | Holds |
|---|---|
| Chart types | Which chart for which question (trend, comparison, part of a whole, status over time) |
| Colour | Categorical, sequential and diverging palettes, built from the Foundations colours |
| Stat tiles and meters | Single numbers, progress, readiness |
| Axes and labels | Units, number formats, label rules |
| Legends and tooltips | Placement, what a hover shows |
| States | Empty, loading, partial data, error |
| Accessibility | Never colour alone, text alternative, contrast for marks |

Elastic UI's **Utilities** section is code helpers, so it is left out. **Token export** (CSS, JSON) stays as it is today.

## 4. Guidelines (base)

The checks a design passes before it is reported as done: the six skills.

| Guideline | Checks |
|---|---|
| Design process | Plan, versions, arrows, stickies, where work lives |
| Design system review | Components, variants, tokens, masters |
| Interaction design review | Clicks, hovers, states, flow continuity |
| Visual craft review | Grid, spacing, alignment, icons |
| UX writing review | Copy, terms, tone |
| Accessibility review | WCAG 2.2 AA |

Rules have one home:
- A rule about one component (*"row buttons in one table share one size"*) moves to that component's page, under Usage, States or Do and don't.
- A rule about a recurring problem (*"errors say what, meanwhile, who acts"*) moves to its pattern page.
- A writing rule moves to Content.
- The skills keep the process (plan, versions, arrows, stickies) and the checks, and each check points to the page that holds the rule.
- A new correction goes to its page, replacing the old line when one exists, so a rule is never written twice.

## 5. How the parts connect

- **Principles** explain the why. Decision stickies and reviews cite them (*"R3 Honest about what the AI does"*).
- **Foundations** feed **Components**, which feed **Patterns** and **Templates**.
- **Content** applies to every component's Content section.
- **Guidelines** check work against all of the above.
- Claude gets the principles and the pages for the components it touches when it builds, not the whole system every turn.

## 6. Still open

Nothing open.

Decided (25 Oct 2026): R1 to R4 as written; all 10 component page headings; component and pattern rules move out of the skills to their pages; data visualisation stays in.
