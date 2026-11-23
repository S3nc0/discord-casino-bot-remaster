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
