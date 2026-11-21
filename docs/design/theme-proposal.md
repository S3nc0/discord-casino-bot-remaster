# Bitbloom theme re-tune: proposal

Status: proposal only. `packages/ui` and `apps/web` are untouched. Open `design/bitbloom/proposal/preview.html` in a browser to compare three columns: current, round 1 and round 2, dark and light (`#dark` / `#light` in the URL show one theme; `#home-dark` shows only the round 2 Home shell).

**Round 2 was approved by the owner on 2026-11-22.**

Round 1 was calm but too grey. Round 2 (below) answers the owner's feedback: closer to the mood reference, and brighter with green, yellow and blue. Round 1 is kept as `tokens.proposal-r1.*` and `components.proposal-r1.css`.

## Why

The owner finds the UI too harsh. Looking at the phone screenshot, the causes are: glaring cyan primary on a green-tinted black, a saturated brown block with a bright outline for the active nav item and tonal buttons, and bright 2px outlines on every container. It reads as many loud colours at once.

## What the mood reference does (codedex.io, home, pricing, community)

- Near-black navy page, cards a step lighter with a hairline edge. Text is still bright; the page is not low-contrast.
- Two accents only on most pages: a flat yellow call-to-action and a sky-blue for selection and links. Pricing adds a loud purple gradient and a glow.
- Chunky buttons: flat fill, 2px darker lip, label in the pixel font. Secondary buttons are transparent with a grey outline.
- Pixel art lives in the hero banner, course thumbnails and small avatars. Navigation, cards and forms are flat and quiet.
- Pixel font for headings only, a clean sans for text, small spaced-out uppercase labels above headings.
- Generous spacing between sections. Small motion: typed heading, twinkling sparkles.

## Adopt / do not adopt

| Adopt | Do not adopt |
| --- | --- |
| Restraint: one primary, one accent, everything else neutral | Their palette and near-black background (ours stays teal and gold on ink) |
| Containers as tonal steps with a soft edge | Rounded pills, blurred glow, purple gradient (no radius, no blur in Bitbloom) |
| Pixel art only in hero and empty states; chrome stays flat | Their logo, mascots, illustrations, copy, brand name |
| Uppercase spaced label above headings (`bb-eyebrow`, 14px) | Yellow call-to-action (our primary action stays teal; gold is the accent) |
| Sprite-like motion: coin bob and sparkle in `steps(2)` | Typing animation |
| More air between sections (24px in the preview) | |

## Round 2: navy base, green / yellow / blue, more pixel art

Direction from the owner: closer to the reference feel, light and bright colours, green, yellow and blue.

- **Dark (default):** deep navy surfaces in tonal steps (`#0d1625` lowest to `#31394b` highest) instead of grey. Text is near white (`#eff1f6`), not dimmed.
- **Light:** warm paper cream (`#f9f3e8`) with deep navy text (`#1e2636`), same three hues.
- **Three hues, each with a job.** Fresh green (`primary`, `success`): actions and wins. Sunny yellow (`tertiary`): Pelica, rewards, the coin, focus ring in dark. Sky blue (`secondary`): info, links, selection, tonal buttons, nav indicator, slider track. Red for errors and orange for warnings stay semantic. No pink.
- **Bright but not glaring.** Mid tones (40 to 80) keep most of their chroma so small accents and pixel art sparkle. Pale tones (90, 95) used for fills are capped, so fills read as soft tints.
- **More pixel art, all drawn here:** nine 16 by 16 game icons (dice, slot machine, cards, roulette wheel, horse, stock bars, pickaxe, sword, coin) used as 4-up tiles on Home; a night skyline strip with lit windows and sparkles (a daytime version in light) across the top of the balance hero; the coin bobs and sparkles twinkle in `steps(2)`, off under reduced motion. Inline SVG, no images. In this preview each icon is about 3 KB and the skyline about 9 KB (627 pixels); shipping them as row strings, the way the nav icons are stored, makes each a few hundred bytes.
- Light balance: the amount sits on a butter plate with a pixel edge, because yellow text is only 5.8:1 in light.

| Hue role | Dark (text on surface / on highest) | Light (text on surface / on highest) | Fill and label |
| --- | --- | --- | --- |
| Green `primary` | `#59c059` 7.4 / 5.0 | `#216c26` 5.9 / 4.6 | label on fill 7.4 dark, 6.3 light |
| Blue `secondary` | `#29b8e9` 7.4 / 5.0 | `#126682` 5.9 / 4.6 | tonal fill `#0b4d63` / `#c0e9fe`, text 7.2 / 13.3 |
| Yellow `tertiary` | `#dfc738` 10.1 / 6.8 | `#6b5f09` 5.8 / 4.6 | butter fill `#504712` / `#f0e2b9`, text 7.2 / 13.3 |

Role table, current → round 2 (ratios are the pair named in the first column, current → round 2):

| Role | Dark: old → new | Light: old → new | Ratio dark | Ratio light |
| --- | --- | --- | --- | --- |
| Page background | `#0b1515` → `#131c2b` | `#f0fcfc` → `#f9f3e8` |  |  |
| Card fill | `#151d1d` → `#192232` | `#eaf6f6` → `#f3ede2` |  |  |
| Field / chip fill | `#2d3637` → `#31394b` | `#d9e5e5` → `#dfd9cf` |  |  |
| Body text | `#d9e5e5` → `#eff1f6` | `#151d1d` → `#1e2636` | 14.4 → 15.1 | 16.4 → 13.7 |
| Supporting text | `#afcccc` → `#bcc7de` | `#324b4c` → `#43536f` | 7.3 → 6.8 | 7.3 → 5.5 |
| Primary (text/icon) | `#00ded1` → `#59c059` | `#006a64` → `#216c26` | 10.9 → 7.4 | 6.2 → 5.9 |
| Text on primary | `#003733` → `#121f10` | `#ffffff` → `#fffcf6` | 7.8 → 7.4 | 6.5 → 6.3 |
| Tonal fill, text on it | `#ffdbc9` → `#c0e9fe` | `#2e1500` → `#021f29` | 7.2 → 7.2 | 13.3 → 13.3 |
| Accent: old `secondary` (orange), new `tertiary` | `#ffb68e` → `#dfc738` | `#9e4200` → `#6b5f09` | 10.9 → 10.1 | 6.2 → 5.8 |
| Control border (`outline`) | `#7b9696` → `#8f9ebe` | `#617c7c` → `#687795` | 3.9 → 4.3 | 3.5 → 3.2 |
| Card / list / nav edge (`outline-variant`) | `#7b9696` → `#374762` | `#617c7c` → `#d1c5b2` | 5.9 → 1.8 | 4.3 → 1.5 |
| Focus ring | `#ffb956` → `#dfc738` | `#1e52d7` → `#3853c7` | 10.9 → 10.1 | 6.2 → 5.9 |
| Snackbar text | `#293232` → `#eff1f6` | `#e7f3f3` → `#eff1f6` | 10.2 → 8.2 | 11.6 → 11.7 |
| Disabled text | `#a2adad` → `#9caccb` | `#566060` → `#4f5f7b` | 5.7 → 5.8 | 5.0 → 5.0 |

| Rarity | Dark tag: old → new | Light tag: old → new |
| --- | --- | --- |
| common (neutral) | text 9.6 → 10.2, accent 10.9 → 10.1 | text 13.3 → 10.8, accent 8.9 → 7.0 |
| uncommon (green) | text 7.3 → 7.2, accent 10.9 → 10.0 | text 13.3 → 13.2, accent 6.2 → 5.9 |
| rare (blue) | text 7.2 → 7.2, accent 10.9 → 10.1 | text 13.2 → 13.2, accent 6.1 → 5.8 |
| epic (violet) | text 7.3 → 7.3, accent 10.9 → 10.0 | text 13.3 → 13.4, accent 6.2 → 5.8 |
| legendary (yellow) | text 7.2 → 7.2, accent 10.9 → 10.1 | text 13.3 → 13.3, accent 6.1 → 5.8 |

Component deltas for round 2 (`components.proposal.css`, about 60 lines): edges become tonal (fill nudged 24% toward the text colour) instead of bright lines; cards, lists, nav, dialogs, banners and tags use the decorative edge; nav indicator, selected chip and selected list row keep the kit's `secondary-container`, which is now sky; optional `bb-eyebrow` label and `bb-game` tile. Structure is unchanged: no radius, 2px notched edges, hard shadows, stepped motion, Pixelify for display, headline and title only, Atkinson 16px and up for body, 48px targets (game tiles are about 100px tall).

Round 2 risks, on top of the list below: (a) yellow in light is a deep mustard (`#6b5f09`) for text because 4.5:1 forces it; the bright yellow lives in fills and art. (b) Green primary and green success are the same family, so success is never distinguished by colour alone (icon and word always present). (c) Green, yellow and sky together can read as a children's palette if used at full size; the rule is soft fills, small saturated accents. (d) The skyline is 627 pixels of SVG path; negligible, and only the Home hero needs it. (e) Game icons use the active palette tones, so they follow the theme automatically; the horse is the weakest drawing and may be redone by an artist.

## Round 1: calm teal and gold on grey ink

### Round 1 palette (role: old → new, contrast old → new)

Tones keep their CIE lightness, so only chroma and hue change; luminance maths is unchanged. Dark is a deep ink grey with a blue lean. Light is warm cream and tan. Primary is a sea teal at about 70% of the old chroma. The accent is coin gold and is now the `tertiary` role. `secondary` becomes a quiet slate (dark) or sand (light) for tonal buttons, slider track and selected fills. `warning` becomes orange so it is not mistaken for the gold accent. Rarity hues keep their hue and drop to about 60% chroma, and the pale tones (90, 95) are capped, which removes the glaring mint and peach.

| Role | Dark: old → new | Light: old → new | Ratio dark | Ratio light |
| --- | --- | --- | --- | --- |
| Page background | `#0b1515` → `#1a1e22` | `#f0fcfc` → `#f7f3ed` | | |
| Card fill | `#151d1d` → `#202428` | `#eaf6f6` → `#f2ede8` | | |
| Field / chip fill | `#2d3637` → `#373c40` | `#d9e5e5` → `#ded9d4` | | |
| Body text | `#d9e5e5` → `#dde3e9` | `#151d1d` → `#282521` | 14.4 → 13.0 | 16.4 → 13.8 |
| Supporting text | `#afcccc` → `#bcc8d4` | `#324b4c` → `#5a5146` | 7.3 → 6.6 | 7.3 → 5.5 |
| Primary (text/icon) | `#00ded1` → `#5bbab2` | `#006a64` → `#306762` | 10.9 → 7.3 | 6.2 → 5.9 |
| Text on primary | `#003733` → `#0a1f1d` | `#ffffff` → `#fffcf8` | 7.8 → 7.4 | 6.5 → 6.3 |
| Tonal fill, text on it | `#ffdbc9` → `#d7e4f0` | `#2e1500` → `#221a10` | 7.2 → 8.6 | 13.3 → 13.3 |
| Accent (old `secondary`, new `tertiary`) | `#ffb68e` → `#d7a15a` | `#9e4200` → `#7b5828` | 10.9 → 7.3 | 6.2 → 5.8 |
| Control border (`outline`) | `#7b9696` → `#86929d` | `#617c7c` → `#7f766a` | 3.9 → 3.5 | 3.5 → 3.2 |
| Card / list / nav edge (`outline-variant`) | `#7b9696` → `#3d4852` | `#617c7c` → `#d0c5b8` | 5.9 → 1.8 | 4.3 → 1.5 |
| Focus ring | `#ffb956` → `#f5bc73` | `#1e52d7` → `#4454bb` | 10.9 → 9.8 | 6.2 → 5.9 |
| Snackbar text | `#293232` → `#e3e9ee` | `#e7f3f3` → `#f4f0eb` | 10.2 → 7.6 | 11.6 → 11.6 |
| Disabled text | `#a2adad` → `#a0adb8` | `#566060` → `#665d52` | 5.7 → 5.7 | 5.0 → 5.0 |

Rarity tags (text on fill / accent on surface, old → new): every pair stays at or above 5.8:1 in both themes, for example dark epic text 7.3 → 7.3, accent 10.9 → 9.9; light legendary text 13.3 → 13.3, accent 6.1 → 5.8. `python3 design/bitbloom/proposal/contrast_check.py --table` prints all of them.

Component deltas (`components.proposal.css`, about 50 lines): filled and tonal button edges, selected chip, list row and nav indicator use a tonal edge (fill mixed 20–28% toward the text colour) instead of a bright text-coloured line; cards, lists, nav bar, dialog, banners and tags use the decorative edge; dialog icon uses the gold accent. Structure is unchanged.

## Contrast proof

`python3 design/bitbloom/proposal/contrast_check.py` resolves both proposed token files and exits 1 on any failure. Output on this branch:

```
round 2 (tokens.proposal.json): 396 checks, 0 failing
round 1 (tokens.proposal-r1.json): 396 checks, 0 failing
```

It checks, in both themes: every `on-X` on `X` and `on-X-container` on `X-container` ≥ 4.5; `on-surface` and `on-surface-variant` on all six surfaces ≥ 4.5; primary, secondary, tertiary, error, success, warning and all 16 hue accents as text on all six surfaces ≥ 4.5; `outline` and `focus-ring` on all six surfaces ≥ 3; snackbar, disabled text ≥ 4.5; text not dimmed (`on-surface` ≥ 10 and `on-surface-variant` ≥ 5.5 on `surface`); `outline-variant` is softer than `outline` yet still a visible step (≥ 1.3 on `surface` and on the card fill); adjacent surface layers differ by ≥ 1.04. For reference the same rules flag 3 items in the current tokens (slider track border 2.95:1 in dark, and `outline-variant` not being softer than `outline` in both themes).

## Risks

1. **Role meanings move.** `secondary` was orange and is now quiet slate or sand; `tertiary` was violet and is now gold; `warning` was amber and is now orange. Check every use in `apps/web` before adopting.
2. **Tests need a rule change.** `packages/ui` and the shell contrast tests require `outline-variant` ≥ 3:1 and the shell forces `--bc: var(--outline)` on cards. Adopting means `outline-variant` becomes decorative (1.5–1.8:1) and the shell override block goes. Decorative edges must never be the only cue for a control; anything meaningful stays on `outline`.
3. **`color-mix()`** is used for the tonal edges (Chrome 111+, Safari 16.2+, Firefox 113+). Older embedded webviews would lose those edges. Mitigation before adopting: precompute explicit `*-edge` tokens.
4. **Gold vs orange.** Accent and warning are close in hue. Banners and tags always carry an icon and a word, so this is not colour-only, but the owner should confirm it looks distinct enough.
5. **Dimmer surfaces, softer edges** are the point, but on dim phone screens in sunlight the 1.5:1 light-theme edge may feel faint. Raise `paper-variant-80` one step if so.
6. **Not tested on real devices.** The check proves ratios, not comfort. The owner's phone review is the real test. Discord's own top bar (the red Leave button) is outside our control.
7. **Light theme warmth.** Cream can look yellow on some screens; the fallback is `paper-97` for `surface`.

## Files

- `design/bitbloom/proposal/tokens.proposal.json` and `tokens.proposal.css`: round 2 (generated by `build_tokens.py`)
- `design/bitbloom/proposal/tokens.proposal-r1.json` and `.css`: round 1
- `design/bitbloom/proposal/components.proposal.css` (round 2) and `components.proposal-r1.css`
- `design/bitbloom/proposal/preview.html` (generated by `build_preview.py`; fonts embedded, no external URLs)
- `design/bitbloom/proposal/contrast_check.py`
