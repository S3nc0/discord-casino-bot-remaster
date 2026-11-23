**English** | [日本語](README.ja.md)

# Button

A pixel-edged button in M3's five emphasis levels, used for any action someone takes on purpose.

| Variant | Class | Use for |
| --- | --- | --- |
| Filled | `bb-btn` | The main action on a screen. One per view. |
| Tonal | `bb-btn bb-btn--tonal` | Important but not main (Invite friends, Save draft). |
| Outlined | `bb-btn bb-btn--outlined` | Secondary choices beside a filled button. |
| Text | `bb-btn bb-btn--text` | Low-emphasis actions: Skip, Learn more, Cancel in dialogs. |
| Danger | `bb-btn bb-btn--danger` | Destructive actions, usually inside a confirm dialog. |

## Anatomy

- 48px minimum height (`target-min`), `space-5` side padding, `label-large` text.
- 2px pixel border (`step-sm` notch) in the container's darkest tone, plus a 4px `pixel-lip` at the bottom so it reads as a block you can press.
- Optional leading icon, 24px, `space-2` from the label.

## States

- Hover, focus and pressed use the M3 state layer (`state-hover` 8%, `state-focus` 10%, `state-pressed` 12%).
- Pressed also drops the button by one art pixel. Keyboard focus adds the `focus-ring` outline.
- Disabled uses `disabled-container` and `on-disabled`. If the reason isn't obvious, say why next to the button. Don't hide it.

## Writing labels

Start with a verb and say what happens: "Plant seeds", not "OK". Two or three words, in sentence case.
