# NavigationBar

The bottom bar for moving between 3–5 top-level destinations on phones. It includes the Badge.

- `surface-container` fill, an icon and a label on every item (labels are never hidden).
- The current page gets `aria-current="page"` and a `secondary-container` pixel pill behind the icon.
- Badges: `bb-badge` (a count, `error` fill, max "99+") or `bb-badge--dot`. Always give the screen reader the meaning too ("3 new items").
