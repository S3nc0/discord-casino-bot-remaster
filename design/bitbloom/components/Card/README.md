# Card

A container for one subject, such as a save slot, an item or a friend, with optional pixel-art media and actions.

- Elevated (`bb-card`): `surface-container-low`, `elevation-1`, `outline-variant` border. Clickable cards rise to `elevation-2` on hover.
- Filled (`--filled`): `surface-container-highest`, no shadow. For grouped content in a list of cards.
- Outlined (`--outlined`): `surface` with an `outline` border. For quiet tips.
- Padding `space-4`, title `title-medium`, meta `body-small`, actions bottom-right.
- Media runs edge to edge at 2:1. Pixel art must use `image-rendering: pixelated`.
- Don't nest cards or put more than two actions in one.
