**English** | [日本語](README.ja.md)

# Progress

A segmented pixel bar that shows how far along something is. It is M3's linear progress indicator.

- Track: 16px, `surface-container-highest`, `outline` pixel border. Fill: 10px segments of `primary` with 2px gaps.
- `--success` turns the segments `success` when something completes. Indeterminate crawls in 12 steps, and with reduced motion it shows a static half-tone bar.
- Always label it, with a number when you know one ("45%", "10 / 10").
