**English** | [日本語](ui-cheatsheet.ja.md)

# Bitbloom UI Cheatsheet (`@casino/ui`)

Import from `@casino/ui` (self-hosted fonts, `tokens.css`, and `bundle.css` load automatically with zero external URLs).

## Setup

Wrap the app root in `<ThemeProvider>` (`theme?: 'light' | 'dark' | 'discord'` — defaults to `'discord'`, `discordTheme?: 'light' | 'dark'`, `reducedMotion?: boolean | 'system' | 'reduce' | 'no-preference'`). Read state with `useTheme()`.

## Design Rules

- **Readable first:** Body copy in Atkinson Hyperlegible (`--font-body`, Japanese system fallbacks included) at **≥16px** (`body-medium`). `label-small` (12px) is for badges only. Sentence case everywhere.
- **Pixelify for headings only:** Use Pixelify Sans (`--font-display`) solely for Display, Headline, and Title styles (56 → 16px).
- **Numbers in Atkinson, never Pixelify:** Pixelify Sans draws 2 like 8 and 5 like S at every size (12,400 reads as 18,400). Money, odds, ranks, timers and counts use the `.num` class (`--font-numeric` = Atkinson Hyperlegible, `tabular-nums`). Digits that land inside a display-font title ("Race 12") are covered by the `Bitbloom Numerals` face already first in `--font-display`, so titles need no override.
- **Pixel borders, no rounding:** 2px (`--pixel`) four-shadow notched edges (`--pb`), `border-radius: 0` everywhere.
- **Hard-offset elevation:** `--elevation-1`..`3` (2px/4px/6px solid offsets, never blur). Filled buttons and FABs have a 4px `--pixel-lip` and drop 1 art pixel when pressed.
- **Stepped motion:** Animations use `steps(n)` timing (`steps(3)`, `steps(12)`); automatically disabled under `prefers-reduced-motion` or `ThemeProvider` `reducedMotion`.
- **Roles, not raw tones:** Build with semantic roles (`primary`, `secondary`, `tertiary`, `success`, `warning`, `error`, `surface*`, `on-surface*`). For rarity/categories, use `Tag` hue roles (`common` neutral, `uncommon` `green`, `rare` `blue`, `epic` `violet`, `legendary` `yellow`).
- **Never colour alone:** Banners have icon + bold title; selected chips show a check; switches print `On`/`Off`; tags pair hue with text.
- **48px targets & visible labels:** Interactive targets are ≥48px (`--target-min`), with a `3px` `--focus-ring` (`5px` offset). Labels stay visible; placeholders are examples only.

## Components (18 + Helpers)

| Component | Key Props | When to Use |
| --- | --- | --- |
| `Banner` | `variant` (`'info'\|'success'\|'warning'\|'error'`), `title`, `icon?`, `children?` | Persistent inline status/alert (`role="alert"` on error, `status` otherwise). |
| `Button` | `variant` (`'filled'\|'tonal'\|'outlined'\|'text'\|'danger'`), `icon?`, `disabled?` | Purposeful verb-led actions; max 1 `filled` per view. |
| `Card` | `variant` (`'elevated'\|'filled'\|'outlined'`), `title?`, `meta?`, `media?`, `actions?`, `href?`, `onClick?` | Single subject container (item, game, table) with up to 2 actions. |
| `Checkbox` / `CheckboxGroup` | `label`, `error?`, `indeterminate?`, `checked?`; Group: `legend` | Multi-select options inside a `fieldset`; 48px clickable rows. |
| `Chip` / `ChipGroup` | `selected?`, `icon?`; Group: `label` | Toggleable filter/assist pills (`aria-pressed`); wraps in `bb-chips`. |
| `Dialog` | `open`, `onClose`, `title`, `description?`, `icon?`, `actions?`, `role?` (`'dialog'\|'alertdialog'`) | Blocking modal decision; traps focus, closes on Esc/scrim, restores focus. |
| `FAB` | `variant` (`'primary'\|'secondary'\|'tertiary'`), `icon`, `label`, `extended?` | Single primary screen action at bottom-right (prefer `extended` on first use). |
| `IconButton` | `variant` (`'standard'\|'filled'\|'tonal'\|'outlined'`), `label` (req.), `pressed?`, `icon?` | Compact 48×48px icon action or toggle (`aria-pressed`). |
| `List` / `ListItem` / `Avatar` | List: `selectable?`, `label?`; Item: `headline`, `supportingText?`, `leading?`, `trailing?`, `selected?`, `onSelect?` | Structured 72px rows with 40px pixel `Avatar` and tabular trailing metadata. |
| `NavigationBar` | `items` (`{ id, label, icon, badge?, badgeLabel? }`), `activeId`, `onSelect`, `label?` | 3–5 top-level destinations with always-visible labels and count/`'dot'` badges. |
| `Progress` | `label`, `value?`, `max?`, `valueLabel?`, `variant?` (`'primary'\|'success'`) | Segmented determinate bar (omit `value` for stepped indeterminate crawl). |
| `Radio` / `RadioGroup` | Group: `legend`, `name`, `value?`, `defaultValue?`, `onChange?`, `options?`; Radio: `value`, `label` | Exclusive choice from 2–4 options inside a `fieldset` (5+ -> use `List`). |
| `Slider` | `label`, `value?`, `defaultValue?`, `min?`, `max?`, `step?`, `formatValue?`, `onChange?` | Range selection with always-visible text readout and `--val` fill. |
| `Snackbar` | `open?`, `message`, `actionLabel?`, `onAction?`, `onDismiss?`, `durationMs?` | Transient feedback (`role="status"`); auto-dismiss ≥6s only without action. |
| `Switch` | `label`, `checked?`, `defaultChecked?`, `onChange?`, `onLabel?`, `offLabel?` | Immediate on/off setting (`role="switch"`) with explicit `On`/`Off` text. |
| `Tabs` | `label`, `tabs` (`{ id, label, icon?, panel?, disabled? }`), `activeId?`, `defaultActiveId?`, `onChange?` | 2–5 peer views; Arrow keys move roving `tabIndex`, Enter/Space activates. |
| `Tag` | `hue?` (`'neutral'` or 16 palette hues), `solid?`, `icon?`, `children` | Non-interactive category, rarity, or status pill; always pair hue with text. |
| `TextField` | `label`, `helperText?`, `error?` (`string \| boolean`), `leadingIcon?` | Single-line input with persistent top label and actionable error text. |
| `Surface` | `label?`, `children?` | Semantic `<section class="bb-surface">` container. |
| `ScrollFade` | `revealSelector?`, `children` | A row that scrolls sideways when it does not fit, with a soft fade on each edge that hides more (chip rows); scrolls the selected child into view on mount. |

## Pixel art

All pixel art is data generated by `tools/pixel-art/` (see [MAINTAINERS.md](../MAINTAINERS.md#regenerating-pixel-art)); never hand-edit it. Colours are palette tokens, so light and dark come from the same rows. Every picture is decorative (`aria-hidden`) unless you pass `label`. Under reduced motion every animation rests on its still frame.

| Export | Key Props | When to Use |
| --- | --- | --- |
| `GameIcon` | `name` (`GameIconName`, 35 icons), `label?`, `bob?` | A game or feature icon on tiles and headers; 16 by 16 art at a whole-number size. |
| `Skyline` | `variant?` (`'night'\|'day'`, follows the theme) | The pixel city behind the Home hero. |
| `Sparkle` | `twinkle?` | A small reward sparkle (`tertiary`). |
| `PixelScene` | `art` (`SceneArt`), `frame?`, `scale?` (whole numbers), `label?`, `children?` | A screen's scene at a crisp whole-number scale, with layers on top. |
| `SceneLayer` | `art`, `frame?`, `x?`, `y?`, `flip?` | A sprite placed inside a `PixelScene` (a horse portrait in its stall, a fighter in the pit). |
| `PixelTile` | `art`, `scale?` | A picture repeated over a whole box (turf, wallpaper). |
| `useSceneFrame` | `(count, ms, play?)` | Frame number of a looping picture; 0 when paused or under reduced motion. |
| `useSceneOnce` | `{ frames, ms, trigger?, rest?, onMount? }` | Frame number of a picture that plays once on demand (answer effect, gift opening), then rests. |

`SceneArt` is `{ w, h, legend, frames }`: each frame is a list of row strings, and `legend` maps a character to a `[light, dark]` pair of palette token names. Screen-only scene wrappers (`CasinoScene`, `FinanceScene`) live next to their screens in `apps/web`.
