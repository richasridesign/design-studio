# Prototype

A front-end prototype made by Design Studio. Every screen runs on fake data from `src/scenarios`, so each state
(signed in, empty, loading, error, no access) can be shown on purpose. There is no backend.

- `src/screens/index.ts` lists the screens and their routes. Add a screen there to see it on the canvas.
- `src/scenarios/index.ts` holds the fake data per state. `?scenario=empty` picks one.
- `src/components` holds the base components, themed by `src/tokens.css` (made from the design system profile).

`npm run dev` runs it on its own. Design Studio's Canvas tab starts it for you.
