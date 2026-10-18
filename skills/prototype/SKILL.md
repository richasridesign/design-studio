---
name: prototype
description: Build a clickable HTML prototype of Figma frames in this chat folder, shown in Design Studio's Preview tab. Use when the designer runs /prototype or asks for a clickable prototype.
---

1. Read the frames the designer named, or the frames in design.json, with get_design_context and get_screenshot.
2. Write a single self-contained file at prototype/index.html: plain HTML, CSS and a little JavaScript, no build step. Use the colors, text styles and spacing from design-system.md as CSS variables.
3. Link the screens with the interactions the brief implies (buttons go to the next screen, back goes back). Show empty, loading and error states where the design has them.
4. Tell the designer it is in the Preview tab. Offer to bring it back into Figma with html_to_figma, and only do that if they say yes.
