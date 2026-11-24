**English** | [日本語](CREDITS.ja.md)

# Credits & Third-Party Notices

All bundled assets in this project run locally with zero external runtime URLs. Every entry below has the same fields: author, licence, source and how it is used. Each reference is listed once.

## Original bot

### discord-casino-bot

- **Author:** fatcorn753
- **License:** MIT License (both authors are named in [LICENSE](LICENSE))
- **Source:** https://github.com/fatcorn753/discord-casino-bot
- **Usage:** The source of the game rules and numbers. This project is a hard fork, rewritten in TypeScript. The original Python code is not in the tree; it is in git history before v1.0.0, and the behaviour specs in `docs/spec/` describe it.

## Audio

### ZzFX (Zuper Zmall Zound Zynth)

- **Author:** Frank Force (KilledByAPixel)
- **License:** MIT License (`Copyright (c) 2019 Frank Force`)
- **Source:** https://github.com/KilledByAPixel/ZzFX
- **Usage:** Vendored TypeScript synthesis engine in `packages/ui/src/audio/zzfx.ts`, powering all procedural retro sound effects in `packages/ui/src/audio/sfx.ts`.

No sampled audio is bundled. See [Future audio samples](#future-audio-samples).

## Pixel art references

No photograph is shipped or kept in the repository: only the generated pixel rows are. To regenerate the art, download a reference into `$ART_REF` as `tools/pixel-art/README.md` describes.

### The Horse in Motion

- **Author:** Eadweard Muybridge (1830 to 1904)
- **License:** Public domain (published 1878; the author died in 1904). Copyright-free reproduction from the Library of Congress Prints and Photographs Division.
- **Source:** https://commons.wikimedia.org/wiki/File:The_Horse_in_Motion_high_res.jpg ("Sallie Gardner" running at a 1:40 gait over the Palo Alto track, 19 June 1878)
- **Usage:** Plate frames 3 to 10 give the eight poses of the race sprite (`apps/web/src/screens/horse/horse-art.ts`): the silhouette was cut out, split into body parts, re-lit and re-coloured with the Bitbloom palette. Frame 12 informed the proportions of the horse head icon. Rider, coat, mane, tail and silks are drawn in code.

### Two men in pelvis clothes boxing (Animal Locomotion, plate 336, "Boxing, open hand")

- **Author:** Eadweard Muybridge (1830 to 1904)
- **License:** Public domain (published 1887; the author died in 1904). Scan from the University of Southern California Libraries.
- **Source:** https://commons.wikimedia.org/wiki/File:Two_men_in_pelvis_clothes_boxing_(rbm-QP301M8-1887-336).jpg
- **Usage:** Frame 7 (guard) and frame 11 (punch) give the idle and attack poses of the 16 arena fighters (`apps/web/src/screens/horse/arena-art.ts`), measured as joint coordinates in `tools/pixel-art/scenes/fighters.js`. Faces, hair, clothes and colours are drawn in code, each fighter an original design.

### Nude farmer using a pick (Animal Locomotion, plate 385, "Farmer, using a pick")

- **Author:** Eadweard Muybridge (1830 to 1904)
- **License:** Public domain (published 1887; the author died in 1904). Scan from the University of Southern California Libraries.
- **Source:** https://commons.wikimedia.org/wiki/File:Nude_farmer_using_a_pick_(rbm-QP301M8-1887-385).jpg
- **Usage:** Frames 4, 6, 8 and 10 give the four poses of the miner's swing (`apps/web/src/screens/life/mine-art.ts`), measured as joint coordinates in `tools/pixel-art/scenes/miner.js`. Clothes, helmet and pickaxe are drawn in code.

### Head of a thoroughbred racehorse

- **Author:** Mjitomobile (Wikimedia Commons user)
- **License:** CC0 1.0 Universal (public domain dedication)
- **Source:** https://commons.wikimedia.org/wiki/File:Head_of_a_thoroughbred_racehorse.jpg
- **Usage:** Outline of the head and neck and the light on them, for the horse portrait in the stall and the paddock (`apps/web/src/screens/horse/stable-art.ts`). The halter, the coat colours and the mane are drawn in code.

### Drawn without references

All other pixel art is drawn in code in `tools/pixel-art/` with no reference images: the 36 game icons (`packages/ui/src/pixel/icon-art.ts`); the app icon and Activity favicons (`tools/pixel-art/app-icon/`); the race track, stall, paddock, arena, mine, shop and storeroom scenery and the ores and relics (`tools/pixel-art/scenes/`); the casino scenes, cards, dice, chips and reel symbols (`tools/pixel-art/casino/`); the quiz, lottery, poll, missions, ranking, relics, transfer, daily bonus, history and profile scenes (`tools/pixel-art/social/`); and the finance scenes, coins, company badges, gavel and dividend coin (`tools/pixel-art/finance/`).

## Tools

### codixel pixel art kit (`core/pixel.js`)

- **Author:** mankidev
- **License:** MIT License (`Copyright (c) 2026 mankidev`), file `tools/pixel-art/vendor/LICENSE`
- **Source:** vendored copy in `tools/pixel-art/vendor/pixel.js`, with its licence file next to it
- **Usage:** PNG, GIF, sheets and outlines for the generators, so the art can be regenerated. Not part of the app bundle.

## Fonts

### Pixelify Sans

- **Author:** Stefie Justprince
- **License:** SIL Open Font License 1.1 (`OFL-1.1`)
- **Source:** https://github.com/eifetx/Pixelify-Sans and https://fonts.google.com/specimen/Pixelify+Sans, packaged via `@fontsource/pixelify-sans` (https://fontsource.org/fonts/pixelify-sans)
- **Usage:** Self-hosted pixel display typeface (`--font-display`) for display, headline and title styles. Numbers do not use its digits (it draws 2 like 8 and 5 like S); they use Atkinson Hyperlegible, below.

### Atkinson Hyperlegible

- **Author:** Braille Institute of America (with Applied Design Works)
- **License:** SIL Open Font License 1.1 (`OFL-1.1`)
- **Source:** https://www.brailleinstitute.org/freefont/, https://github.com/googlefonts/atkinson-hyperlegible and https://fonts.google.com/specimen/Atkinson+Hyperlegible, packaged via `@fontsource/atkinson-hyperlegible` (https://fontsource.org/fonts/atkinson-hyperlegible)
- **Usage:** Self-hosted body typeface (`--font-body`) for text and controls, and for every number: `--font-numeric` and the `Bitbloom Numerals` face (`packages/ui/src/styles/numerals.css`), which uses the same bundled files for the digits inside display titles. No other font file ships.

## Future audio samples

When adding sampled audio (for example music loops or ambient tracks):

1. Only use **CC0 1.0 Universal** (or an equally permissive public-domain or MIT) asset.
2. Bundle the file inside the workspace; never reference an external runtime URL.
3. Record it below with its asset path, title and author, licence and source URL.

| Asset path | Title & Author | License | Source URL |
| --- | --- | --- | --- |
| *(none yet)* | — | — | — |
