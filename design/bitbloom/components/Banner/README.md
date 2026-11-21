# Banner

An inline message that stays on the page until the situation changes, in four tones.

- Tones: `--info` (sky), `--success`, `--warning`, `--error`. Each uses its container and on-container roles with a matching pixel border.
- Every banner has an icon and a bold title, so tone never depends on color alone.
- Errors use `role="alert"`. The others use `role="status"`.
- Say what happened and what to do next, in plain words. No error codes in the title.
