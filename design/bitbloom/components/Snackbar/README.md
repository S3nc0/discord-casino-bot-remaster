# Snackbar

A brief message about something that just happened, shown at the bottom of the screen with an optional action.

- `inverse-surface` fill, `inverse-on-surface` text, action in `inverse-primary`, `elevation-2`.
- One line, one action at most. Offer Undo instead of asking "Are you sure?" whenever an action can be reversed.
- Stays at least 6 seconds. With an action, it stays until dismissed or the action is used.
- Use `role="status"` so screen readers announce it.
