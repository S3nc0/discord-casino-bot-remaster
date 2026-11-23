# Credits & Third-Party Notices

All bundled assets in this project run locally with zero external runtime URLs.

## Audio Synthesizer

### ZzFX (Zuper Zmall Zound Zynth)

- **Author:** Frank Force (KilledByAPixel)
- **License:** MIT License (`Copyright (c) 2019 Frank Force`)
- **Source:** https://github.com/KilledByAPixel/ZzFX
- **Usage:** Vendored TypeScript synthesis engine in `packages/ui/src/audio/zzfx.ts` powering all procedural retro SFX presets in `packages/ui/src/audio/sfx.ts`.

## Pixel Art

### Racehorse sprite: reference photographs

The eight-frame gallop in `apps/web/src/screens/horse/horse-art.ts` was made by turning a public domain photo series into pixels (silhouette cut out, split into body parts, re-lit and re-coloured with the Bitbloom palette). The photograph itself is not shipped: only the generated pixel rows are in the repository.

- **Title:** The Horse in Motion ("Sallie Gardner" running at a 1:40 gait over the Palo Alto track, 19 June 1878)
- **Author:** Eadweard Muybridge (1830 to 1904)
- **License:** Public domain (published 1878; the author died in 1904). Copyright-free reproduction from the Library of Congress Prints and Photographs Division.
- **Source:** https://commons.wikimedia.org/wiki/File:The_Horse_in_Motion_high_res.jpg
- **Usage:** Plate frames 3 to 10 give the eight poses of the race sprite; frame 12 informed the proportions of the horse head icon. Rider, coat, mane, tail and silks are drawn in code.

### Scene art: reference photographs

The arena fighters, the miner and the horse portraits (`apps/web/src/screens/horse/arena-art.ts`, `apps/web/src/screens/life/mine-art.ts`, `apps/web/src/screens/horse/stable-art.ts`) were made from the references below: poses measured on the plates, the head shape and the light sampled from the photograph, then redrawn in code with the Bitbloom palette (`tools/pixel-art/scenes/`). No photograph is shipped or kept in the repository: only the generated pixel rows are.

- **Title:** Two men in pelvis clothes boxing (Animal Locomotion, plate 336, "Boxing, open hand")
- **Author:** Eadweard Muybridge (1830 to 1904)
- **License:** Public domain (published 1887; the author died in 1904). Scan from the University of Southern California Libraries.
- **Source:** https://commons.wikimedia.org/wiki/File:Two_men_in_pelvis_clothes_boxing_(rbm-QP301M8-1887-336).jpg
- **Usage:** Frame 7 (guard) and frame 11 (punch) give the idle and attack poses of the 16 arena fighters. Faces, hair, clothes and colours are drawn in code, each fighter an original design.

- **Title:** Nude farmer using a pick (Animal Locomotion, plate 385, "Farmer, using a pick")
- **Author:** Eadweard Muybridge (1830 to 1904)
- **License:** Public domain (published 1887; the author died in 1904). Scan from the University of Southern California Libraries.
- **Source:** https://commons.wikimedia.org/wiki/File:Nude_farmer_using_a_pick_(rbm-QP301M8-1887-385).jpg
- **Usage:** Frames 4, 6, 8 and 10 give the four poses of the miner's swing. Clothes, helmet and pickaxe are drawn in code.

- **Title:** Head of a thoroughbred racehorse
- **Author:** Mjitomobile (Wikimedia Commons user)
- **License:** CC0 1.0 Universal (public domain dedication)
- **Source:** https://commons.wikimedia.org/wiki/File:Head_of_a_thoroughbred_racehorse.jpg
- **Usage:** Outline of the head and neck and the light on them, for the horse portrait in the stall and the paddock. The halter, the coat colours and the mane are drawn in code.

All other pixel art (the 35 game icons in `packages/ui/src/pixel/icon-art.ts`, the race track, stall, paddock, arena, mine, shop and storeroom scenery, the ores and relics) is drawn in code in `tools/pixel-art/` with no reference photographs.

### Pixel art kit

- **Name:** codixel `core/pixel.js`
- **Author:** mankidev
- **License:** MIT License (`Copyright (c) 2026 mankidev`), file `tools/pixel-art/vendor/LICENSE`
- **Usage:** Vendored in `tools/pixel-art/vendor/pixel.js` (PNG, GIF, sheets, outlines) so the art can be regenerated. Not part of the app bundle.

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
