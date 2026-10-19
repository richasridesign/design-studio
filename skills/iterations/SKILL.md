---
name: iterations
description: Where new work goes in a Figma file adopted as flows and iterations. Use before adding screens, sections, notes or stickies to a flow, or when asked to start a new iteration or version.
---

The chat's prompt names the flow and iteration this chat works on, with their node ids. The layout:

1. Page level: one section per iteration, named "V<id> · <topic> · <weekday date>" (for example "V1.19 · Readiness · Tue 20 Oct 2026"). A new iteration section goes ABOVE the topmost existing one, 800px clear of it. Never move, resize or rename the existing ones.
2. Inside an iteration section: one subsection per flow, named "V<id> · Flow <n> · <flow name>", stacked in flow order with 800px between them. Supporting states (voice, attach, error, branches) go in a sibling subsection "V<id> · Flow <n> · States".
3. Each flow subsection starts with copies of the flow's entry screens, named "<name> (Entry, unchanged)". Leave them unchanged and wire them into the new screens, so every link stays inside the iteration.
4. Put every new or changed screen in your own flow subsection only. End each edit by fitting your subsection. Design Studio restacks the subsections after your turn.
5. Under each new or changed screen, put 3 to 5 Decision stickies right below it: one bold decision line and one "Why:" line each, about 25 words, product direction only.
6. Frozen iterations, the LATEST baseline and the Parked section are history: read them, never edit them. Components get new variants only.
7. Tag a section you create with shared plugin data in the "designstudio" namespace (kind, iteration, flow, project), as the prompt says, so Design Studio finds it after a cut and paste.
