**English** | [日本語](README.ja.md)

# Bitbloom

Bitbloom is a friendly design system that pairs Material 3's color science and component structure with the look of pixel art. It suits cozy games, kids' and learning apps, community tools and anything that should feel playful while still being easy for everyone to use.

There are two themes, Light and Dark. The color system has 16 hues in 11 tones each, M3 color roles built from those tones, and 18 components. The pixel style shows in the edges, shadows, icons and motion. Text stays in a highly readable typeface.

## Principles

1. **Readable first, retro second.** Pixel fonts are for display sizes only. Everything people read is set in Atkinson Hyperlegible at 16px or larger.
2. **Big, obvious targets.** Every tappable thing is at least 48×48px (`target-min`). Labels are always visible, both on fields and in the navigation bar.
3. **Never color alone.** Selected chips show a check. Banners carry an icon and a title. Switches say On or Off. Tags pair a hue with a word.
4. **Say what happens.** Buttons start with a verb, errors say how to fix the problem, and dialogs say what will and won't be lost.
5. **One art pixel is 2px.** Borders, corner notches, shadows and steps are all multiples of `pixel`. Nothing is blurred or anti-aliased.

## Color

### The palette

16 hues, each in tones 10, 20, 30, 40, 50, 60, 70, 80, 90, 95 and 99: red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, magenta, pink and brown. On top of that there's a `neutral` palette (24 tones, from 0 to 100) and a `neutral-variant` palette for borders and supporting text, in navy for dark. Light surfaces use the warm `paper` and `paper-variant` palettes.

Tones follow M3's rule: the number is lightness from 0 (black) to 100 (white), and it holds across hues. That makes contrast predictable:

- Tones **50 apart** give at least **4.5:1**, which is safe for text. Examples: `teal-40` on `teal-90`, `red-10` on `red-90`.
- Tones **40 apart** give at least **3:1**, which is fine for icons, borders and large text.

### Roles

Build UI with roles, not raw tones, so both themes work automatically. Every role is an alias of a palette tone.

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| `primary` | green-40 | green-70 | Main actions, success. Fresh green, the one primary colour |
| `secondary` | sky-40 | sky-70 | Info, links, selection. Tonal buttons, chips, nav indicator and slider track via `secondary-container` |
| `tertiary` | yellow-40 | yellow-80 | Pelica, rewards, highlights, the coin. Sparingly |
| `error` / `success` / `warning` | red / green / orange 40 | red 70 / green 80 / orange 80 | Status. Orange, so warning is never mistaken for the yellow accent |
| `surface` … `surface-container-highest` | paper 96 → 87 | neutral 10 → 24 (navy) | Backgrounds, in layers. Warm paper in light, deep navy in dark |
| `on-surface`, `on-surface-variant` | neutral-15, nv-35 | neutral-95, nv-80 | Text. Never dimmed |
| `outline` | nv-50 | nv-65 | Borders that carry meaning: fields, buttons, switches, sliders (3:1 or more) |
| `outline-variant` | paper-variant-80 | nv-30 | Decorative tonal edge for cards, lists, nav and dividers (about 1.5 to 1.8:1). Never the only cue for a control |
| `focus-ring` | indigo-40 | yellow-80 | Keyboard focus, always 3px |

Each of `primary`, `secondary`, `tertiary`, `error`, `success` and `warning` comes with `on-*`, `*-container` and `on-*-container`, as in M3.

### Hue roles: the palette in the UI

Every hue also has three roles that adapt to the theme: `<hue>-accent` (icons and text on surfaces), `<hue>-container` (fills) and `on-<hue>-container` (text on that fill). Use them for tags, categories, rarity, charts and illustrations. All 16 hues pass 4.5:1 in both themes, so you can use any of them without checking contrast.

Pick hues by meaning and keep them consistent. A suggested set for games:

- **Rarity:** common neutral, uncommon `green`, rare `blue`, epic `violet`, legendary `yellow`.
- **Elements:** fire `orange`, water `sky`, earth `brown`, nature `lime`, ice `cyan`, magic `magenta`.
- **Categories in charts:** use hues at least three steps apart around the wheel, and vary the tone too, so they differ in lightness and not only in hue.

## Type

| Role | Family | Sizes |
| --- | --- | --- |
| Display, Headline, Title | Pixelify Sans (`font-display`) | 56 → 16px |
| Body, Label | Atkinson Hyperlegible (`font-body`) | 18 → 12px |

This is M3's full 15-style scale. Body sizes run about 2px larger than M3's for comfort: `body-medium` is 16px and is the floor for anything people must read. `label-small` (12px) is for badges only. Use sentence case everywhere, including buttons.

## Shape, depth and motion

- **Pixel border.** Controls draw a 2px border with four hard shadows, so each corner loses exactly one art pixel (`step-sm`). Large surfaces may use the two-step corner (`step-lg`). There is no `border-radius` anywhere.
- **Elevation is offset, not blur.** `elevation-1` to `elevation-3` are solid shadows offset by 2, 4 and 6px down-right, in `neutral-variant-80` (light) or black (dark).
- **The pressable lip.** Filled buttons and FABs have a 4px darker bottom (`pixel-lip`) and move down one art pixel when pressed.
- **State layers.** M3's opacities are kept as tokens: `state-hover` 0.08, `state-focus` 0.10, `state-pressed` 0.12, `state-dragged` 0.16.
- **Motion moves in steps.** Transitions use `steps(n)` timing, the way sprites animate. With `prefers-reduced-motion`, all of it is turned off.

## Spacing

The base unit is 4px: `space-1` (4) up to `space-12` (48). `pixel` (2px) is for borders and art. Card padding is `space-4` on phones and `space-6` on larger screens. Sections sit `space-8` apart.

## Iconography and art

Pixel art is drawn in code, as row strings (one character per art pixel), the way the nav icons are. The kit ships nine 16×16 game icons (dice, slots, cards, roulette, horse, stocks, pickaxe, sword, coin), a night and a day skyline strip and a sparkle: `GameIcon`, `Skyline` and `Sparkle` in `packages/ui/src/pixel/`. Each character maps to a palette tone through a `.bb-px-*` or `.bb-sky-*` class, so no colour is inline and the skyline follows the theme. The coin bobs and sparkles twinkle in `steps(2)`; both stop under reduced motion.

- Icons are drawn on a 12×12 grid, shown at 24px (2px per art pixel) and filled with `currentColor`. Keep strokes one art pixel wide and leave a one-pixel margin.
- Illustrations and avatars are drawn at 8, 16 or 32px and scaled by whole numbers, with `image-rendering: pixelated`.
- Draw art from the palette's tones so it sits with the UI in both themes. Don't use gradients; use dithering (a checkerboard of two tones) to blend.

## Accessibility checklist

- Text at least 4.5:1, and borders, icons and the focus ring at least 3:1. All roles meet this in both themes.
- Targets at least 48px, and the whole row is clickable for checkboxes, radios and switches.
- Visible focus on every control, using `focus-ring` with a 5px offset.
- Labels stay visible. Placeholders are examples, never labels.
- Status is never shown by color alone.
- Motion respects reduced-motion settings.

## Building and checking the tokens

`python3 design/bitbloom/build_tokens.py` rebuilds `tokens.json` and `tokens.css` from the original palette kept in `proposal/archive/`. `python3 design/bitbloom/contrast_check.py` checks every role pair in both themes (396 checks, exits 1 on any failure). CI runs the same rules as `packages/ui/src/styles/contrast.test.ts` against the CSS the app loads, and checks that it matches `tokens.json`.

## Using it

Load `tokens.css`, then `components/bundle.css`. Every component is a plain CSS class prefixed `bb-` on native HTML elements, so there's no JavaScript or framework to install. Each component's page shows its markup and states.
