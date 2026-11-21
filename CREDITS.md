# Credits & Third-Party Notices

All bundled assets in this project run locally with zero external runtime URLs.

## Audio Synthesizer

### ZzFX (Zuper Zmall Zound Zynth)

- **Author:** Frank Force (KilledByAPixel)
- **License:** MIT License (`Copyright (c) 2019 Frank Force`)
- **Source:** https://github.com/KilledByAPixel/ZzFX
- **Usage:** Vendored TypeScript synthesis engine in `packages/ui/src/audio/zzfx.ts` powering all procedural retro SFX presets in `packages/ui/src/audio/sfx.ts`.

## Fonts

### Pixelify Sans

- **Designer:** Stefie Justprince
- **License:** SIL Open Font License 1.1 (`OFL-1.1`)
- **Source:**
  - https://github.com/eifetx/Pixelify-Sans
  - https://fonts.google.com/specimen/Pixelify+Sans
  - Packaged via `@fontsource/pixelify-sans` (https://fontsource.org/fonts/pixelify-sans)
- **Usage:** Self-hosted pixel display typeface (`--font-display`) for Display, Headline, and Title styles.

### Atkinson Hyperlegible

- **Author:** Braille Institute of America (with Applied Design Works)
- **License:** SIL Open Font License 1.1 (`OFL-1.1`)
- **Source:**
  - https://www.brailleinstitute.org/freefont/
  - https://github.com/googlefonts/atkinson-hyperlegible
  - https://fonts.google.com/specimen/Atkinson+Hyperlegible
  - Packaged via `@fontsource/atkinson-hyperlegible` (https://fontsource.org/fonts/atkinson-hyperlegible)
- **Usage:** Self-hosted body typeface (`--font-body`) for UI copy and controls.

## Future CC0 Audio Samples

No external or sampled audio files are currently bundled; all SFX are procedurally synthesized via ZzFX.

When adding future sampled audio assets (e.g., background music loops or ambient tracks):

1. Only use **CC0 1.0 Universal** (or equivalently permissive public-domain/MIT) assets.
2. Bundle audio files locally inside the workspace — never reference external runtime URLs.
3. Record each added file below with its asset path, title/author, license (`CC0-1.0`), and original source URL.

| Asset path | Title & Author | License | Source URL |
| --- | --- | --- | --- |
| *(none yet)* | — | — | — |
