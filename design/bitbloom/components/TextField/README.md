# TextField

A single-line text input with its label always visible above it. It is M3's outlined field, made friendlier.

- The label stays above the box and never floats or disappears. Placeholder text is only an example, never the label.
- Box: 48px tall, `surface-container-lowest` fill, `outline` pixel border. Focus switches the border to `primary` and adds the `focus-ring`.
- Helper text below in `body-small`. On error it turns `error`, starts with a warning icon, and says how to fix the problem.
- Leading icons are optional and decorative.
