---
name: handoff
description: Prepare developer handoff for Figma frames: asset exports, specs, Code Connect coverage and a ticket draft. Use when the designer runs /handoff.
---

1. Use the frames the designer named, or the frames in design.json.
2. Export icons and images with download_assets into handoff/assets/.
3. Write handoff/specs.md: per screen the layout, components with their variants, color and text tokens, spacing, states, and interactions. Use token names, not raw values.
4. Check Code Connect with get_code_connect_map and list components that have no mapping.
5. Draft a ticket in handoff/ticket.md: a short imperative title and two or three plain sentences on what to build. Do not create the ticket anywhere; the designer copies it.
6. Reply with what is in the handoff folder and any gaps.
