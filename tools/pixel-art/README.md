# Pixel art generators

The game icons and the race horse are generated, not hand-edited. Run from the repository root.

```sh
# icons: writes packages/ui/src/pixel/icon-art.ts and the fills in packages/ui/src/styles/bundle.css
node tools/pixel-art/icons/build.js

# preview sheet of the icons (needs ART_OUT, a folder for pictures)
ART_OUT=/some/folder node tools/pixel-art/icons/sheet.js

# race horse: writes apps/web/src/screens/horse/horse-art.ts and the coat and silks colours in horse.css
ART_OUT=/some/folder ART_REF=/some/folder/ref node tools/pixel-art/horse/ship.js

# previews (step sheet, gallop gif, eight coats) and the README gif
ART_OUT=/some/folder ART_REF=/some/folder/ref node tools/pixel-art/horse/build.js
node tools/pixel-art/horse/readme.js
```

- `vendor/pixel.js` is the MIT licensed codixel core (licence file next to it).
- Every colour is a step of the round 2 palette (`design/bitbloom/tokens.css`); `lib/palette.js` names the steps. One light, from the top left.
- `icons/*.js` draw each icon as shapes at 8x size (`lib/hi.js`) and cut them into 16 by 16 cells.
- The horse needs the reference plate: download `The_Horse_in_Motion_high_res.jpg` (Eadweard Muybridge, 1878, public domain, see `CREDITS.md`), convert it to a PNG half the size (`sips -s format png -Z 2847`) and save it as `$ART_REF/muy_half.png`. The photograph is not kept in the repository.

## Scenes

The scenery behind the race, the stable and breeding views, the arena, the mine, the shop and the inventory, with the sprites that stand in it. Run from the repository root.

```sh
# writes race-art.ts, stable-art.ts, arena-art.ts (apps/web/src/screens/horse/)
# and mine-art.ts, shop-art.ts, inventory-art.ts (apps/web/src/screens/life/), then formats them
ART_REF=/some/folder/ref node tools/pixel-art/scenes/ship.js

# previews, not shipped: sheets at 3x to 6x, gifs, the pictures one by one
ART_OUT=/some/folder ART_REF=/some/folder/ref node tools/pixel-art/scenes/preview-race.js
#   ... preview-stable.js, preview-portrait.js, preview-arena.js, preview-fighters.js,
#       preview-mine.js, preview-finds.js, preview-shop.js, preview-pack.js (4x sheets and gifs)

# the README gallop gif: the race frames on the night turf with dust
node tools/pixel-art/scenes/readme-gallop.js
```

- Each picture is drawn twice by the same code, with a day palette (light theme) and a night palette (dark theme); the arena, the mine, the shop and the storeroom are the same in both. `kit.js` encodes the pair as row strings and a legend `char -> [light token, dark token]`; `PixelScene` in `packages/ui/src/pixel/` fills each character with `var(--token)` of the active theme, at a whole-number scale.
- Layers: the stall and the paddock have a back and a front (door, fence) so the horse portrait sits between them; fighters and the miner are separate sprites placed on the pit and the mine.
- `race.js` grandstand and crowd, turf tiles with mowing stripes, inner rail, starting gate, dust (4 frames). `stable.js` stall and paddock. `portrait.js` the horse head in the roles of the race sprite (`.hr-px-<char>`), so the coat and silks classes colour it. `arena.js` the pit (3 torch frames). `fighters.js` 16 fighters, idle and attack, both directions. `mine.js` and `miner.js` the mine and the 4-frame swing. `finds.js` 6 ores and 6 relics as 16 by 16 icons. `shop.js` shop shelves, storeroom and the tiles behind item icons.
- References (see `CREDITS.md`; save them as PNG in `$ART_REF`, never in the repository): `head_tb.png`, "Head of a thoroughbred racehorse.jpg" (CC0) at 900 px wide, for `portrait.js`. The fighter and miner poses are measured joint coordinates from Muybridge plates 336 and 385 (public domain), written in `fighters.js` and `miner.js`, so those need no file.

## Casino scenes

```sh
# writes apps/web/src/screens/casino/art/*-art.ts (prettier runs on them)
node tools/pixel-art/casino/ship.js

# previews: 4x sheets, gifs and numbered frame sheets of every scene
ART_OUT=/some/folder node tools/pixel-art/casino/preview.js
```

- `casino/kit.js` holds the casino ramps (felt, porcelain, tatami, lacquer, chrome, brass and the fruit), a 3 by 5 font and the sphere and outline helpers; `shared.js` the chips, the Pelica coin and the win burst; `symbols.js` the six reel symbols.
- One file per game draws its scene: `slots.js` (cabinet, reels, spin blur), `chinchiro.js` (tatami, donburi bowl, dice and their tumble), `cards.js` and `table.js` (52 faces with J/Q/K portraits, the back, the dealer's strip, arc and rail), `roulette.js` (wheel, ball, betting board), `pachinko.js` (machine face, pins, tulips, lamp, ball paths).
- `ship.js` stores each sprite as row strings with its own legend of palette tokens. Parts that change (bulbs, lever, lamp, tulips, a lit pocket) ship as a base with holes plus one small overlay per state. The screens draw them as SVG paths filled from the token variables, at a whole number of device pixels per art pixel.
- Drawn from scratch: no reference images.

## Social and player scenes

The pictures above the quiz, lottery, poll, missions, ranking, relics and transfer screens, the daily bonus room, the history ledger and the profile card. Drawn in code with no references. Run from the repository root.

```sh
# writes quiz-art.ts, lottery-art.ts, poll-art.ts, missions-art.ts, ranking-art.ts, relics-art.ts,
# transfer-art.ts (apps/web/src/screens/life/), daily-art.ts, history-art.ts
# (apps/web/src/screens/casino/) and profile-art.ts (apps/web/src/screens/profile/), then formats them
node tools/pixel-art/social/ship.js

# previews, not shipped: 4x sheets and gifs of every scene
ART_OUT=/some/folder node tools/pixel-art/social/preview.js
```

- Every scene is 176 art pixels wide, drawn at 2 CSS px per art pixel (352 px, inside a 390 px phone). Scenes carry their own frame and wall, so the light and dark themes use the same tokens and the scene reads on navy and on cream alike.
- Animated parts ship as small overlays: `ship.js` draws every frame in full, finds the box where any frame differs from the still one, and cuts only that box (`*_AT` gives where it goes). Frame 0 of an overlay is the still frame, which is what reduced motion shows (`useSceneFrame` and `useSceneOnce` in `packages/ui/src/pixel/` stay on it).
- `kit.js` shared helpers: `prop()` draws a lit part at 8x (`lib/hi.js`), `frame()` the stepped 2 px border, `glaze()` a dithered tint. `person.js` a 26 by 32 character (coat, hair, arm pose).
- `quiz.js` game-show stage, sign bulbs (2 frames) and the host; `fx.js` the right ring and wrong cross (4 frames, the last is still). `lottery.js` festival counter and the drawing globe (6 frames), the ticket. `poll.js` booth, voter and ballot box, the ballot drop (8 frames). `missions.js` the quest board, pin heads, done stamp. `ranking.js` podium, trophy glint (8 frames), medals 1 to 3. `relics.js` the museum hall and, per case, a silhouette and four glow levels around the mine's relic sprite (`scenes/finds.js`), so both screens show the same relic. `transfer.js` the street and the letter flight (8 frames). `daily.js` the room, calendar stamp and gift box (6 frames). `history.js` the ledger desk. `profile.js` the player card and its slots (`PROFILE_SLOTS`); the avatar placeholder is a bust drawn in `ship.js`.
- Numbers placed on these scenes (plaques, stats) use the reading face (`--font-body`): the display face draws 2 and 5 too close to 8 at small sizes.

