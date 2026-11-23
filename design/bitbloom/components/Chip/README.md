**English** | [日本語](README.ja.md)

# Chip

A compact, toggleable control for filtering or picking options. It covers M3's filter and assist chips.

- 32px tall, `label-large` at 14px, pixel border in `outline`.
- Selected sets `aria-pressed="true"`, fills with `secondary-container` and shows a leading check icon, so the state never depends on color alone.
- Lay chips out in `bb-chips` with a `space-3` gap, and let them wrap. Don't scroll them sideways.
- For a status label that isn't clickable, use Tag.
