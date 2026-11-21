# Dialog

A modal for decisions that need an answer before moving on. It is M3's basic dialog with a pixel frame.

- `surface-container-high`, `outline` border, `elevation-3`, over a `scrim`.
- Optional icon on top in `secondary`. Title in `headline-small`, centered when there's an icon.
- Body says exactly what will happen, including what won't.
- Actions on the right: the dismissive one as a text button first, the confirming one last. The confirm label repeats the verb from the title ("Delete", not "OK").
- Esc and clicking the scrim cancel. Focus moves into the dialog and returns when it closes.
