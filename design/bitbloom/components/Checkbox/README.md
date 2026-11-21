# Checkbox

A pixel-drawn checkbox for choosing any number of options from a list.

- Native `input type="checkbox"` inside a `bb-check` label. The whole 48px row is the target.
- The box is a 12×12 pixel mask drawn at 24px: `on-surface-variant` when off, a filled `primary` box with the check cut out when on.
- Group related options in a `bb-group` fieldset with a legend.
- For a single setting that takes effect immediately, use Switch.
