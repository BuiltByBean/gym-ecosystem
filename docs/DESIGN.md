# Design

Not a generic fitness template. The reference object is **well-made gym equipment**: matte steel, machined numerals, one clear action. Not a social app, and not neon-on-black — the member surface is used at arm's length in a brightly lit room, where a light, high-contrast surface wins on legibility (the cliché is rejected on function, not taste).

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#16181D` | primary text, near-black with a cold cast |
| `--paper` | `#F7F5F2` | app background, warm chalk-white |
| `--steel` | `#5B6472` | secondary text, borders at 25% |
| `--brand` | per-gym (default `#C8472B`, oxidized iron) | the white-label variable: actions, active states, accents |
| `--signal` | `#1F7A4D` | success, PR celebrations |
| `--alarm` | `#A23B2E` | destructive, overdue, out-of-service |
| `--card` | `#FFFFFF` | raised surfaces |

Brand color is a **runtime CSS variable** set from the gym's settings the moment the session loads — the design must survive any hue a gym picks. Rules that make that safe: brand is never used for body text; on-brand text color is computed (white/ink by luminance); brand appears at full strength only on primary actions and the active nav item.

## Type

- **Display: Archivo** (variable). Wide, industrial, machined — set tight (`-0.02em`), used for headings and every number that matters.
- **Body: Inter** (variable). Neutral, excellent at small sizes for dense admin tables.

**Signature element — scoreboard numerals.** Workout data (weights, reps, timers, PRs) is always Archivo in tabular figures, oversized relative to its context: the workout player's active set reads like the display on a piece of equipment, legible from a barbell's length away. This is the thing the product should be remembered for; nothing else on screen competes with the number.

## Layout

- **Member surface** (phone, mid-workout): single column, bottom tab bar, one primary action per screen, tap targets ≥ 48px, minimal chrome. Rest timer and active set dominate. Reduced-motion respected; celebration moments are type-scale, not confetti physics.
- **Staff surface** (desk): left rail, dense tables, keyboard-friendly forms. Same tokens, tighter scale.
- Empty states always say what to do next ("No equipment yet — add your first machine and print its QR tag"), never just "no data".

## Accessibility

WCAG 2.2 AA contrast on all text (ink-on-paper is 14.9:1), visible focus rings (`--brand` 2px offset), every control labeled, layout stable during loading (skeletons sized like content).
