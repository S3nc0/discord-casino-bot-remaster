[English](ui-cheatsheet.md) | **日本語**

# Bitbloom UI チートシート（`@casino/ui`）

`@casino/ui` から import します（自前で配信するフォント、`tokens.css`、`bundle.css` は自動で読み込まれ、外部 URL は一切使いません）。

## セットアップ

アプリのルートを `<ThemeProvider>` で包みます（`theme?: 'light' | 'dark' | 'discord'` は既定が `'discord'`、`discordTheme?: 'light' | 'dark'`、`reducedMotion?: boolean | 'system' | 'reduce' | 'no-preference'`）。状態は `useTheme()` で読みます。

## デザインのルール

- **まず読みやすさ:** 本文は Atkinson Hyperlegible（`--font-body`。日本語のシステムフォントのフォールバック付き）を **16px 以上**（`body-medium`）で使います。`label-small`（12px）はバッジ専用です。文は常に sentence case です。
- **Pixelify は見出しだけ:** Pixelify Sans（`--font-display`）は、Display、Headline、Title のスタイル（56 → 16px）にだけ使います。
- **ピクセルの枠線、角丸なし:** 2px（`--pixel`）の、四隅に切り欠きのある 4 方向のシャドウ枠（`--pb`）を使い、`border-radius: 0` をどこでも守ります。
- **ぼかさない段差の影:** `--elevation-1`〜`3`（2px / 4px / 6px の実線のオフセット。ぼかしは使いません）。塗りのボタンと FAB は 4px の `--pixel-lip` を持ち、押すとアートのピクセル 1 つ分下がります。
- **コマ送りの動き:** アニメーションは `steps(n)` のタイミング（`steps(3)`、`steps(12)`）を使い、`prefers-reduced-motion` か `ThemeProvider` の `reducedMotion` で自動的にオフになります。
- **生の色ではなくロール:** 意味を持つロール（`primary`、`secondary`、`tertiary`、`success`、`warning`、`error`、`surface*`、`on-surface*`）で組み立てます。レア度やカテゴリーには `Tag` の hue ロールを使います（`common` は neutral、`uncommon` は `green`、`rare` は `blue`、`epic` は `violet`、`legendary` は `yellow`）。
- **色だけに頼らない:** バナーはアイコンと太字のタイトルを持ち、選択中のチップにはチェックが付き、スイッチは `On` / `Off` と表示し、タグは色と文字を組にします。
- **48px のタップ領域と見えるラベル:** 操作できる対象は 48px 以上（`--target-min`）で、`3px` の `--focus-ring`（`5px` のオフセット）を付けます。ラベルは常に表示し、プレースホルダーは例を示すだけにします。

## コンポーネント（18 個とヘルパー）

| コンポーネント | 主な props | 使う場面 |
| --- | --- | --- |
| `Banner` | `variant`（`'info'\|'success'\|'warning'\|'error'`）、`title`、`icon?`、`children?` | 画面に残る、インラインの状態表示や警告（エラーは `role="alert"`、それ以外は `status`）。 |
| `Button` | `variant`（`'filled'\|'tonal'\|'outlined'\|'text'\|'danger'`）、`icon?`、`disabled?` | 動詞で始まる、意図のある操作。`filled` は 1 画面に最大 1 つ。 |
| `Card` | `variant`（`'elevated'\|'filled'\|'outlined'`）、`title?`、`meta?`、`media?`、`actions?`、`href?`、`onClick?` | 1 つの対象（アイテム、ゲーム、テーブル）を入れる入れ物。操作は最大 2 つ。 |
| `Checkbox` / `CheckboxGroup` | `label`、`error?`、`indeterminate?`、`checked?`。Group: `legend` | `fieldset` の中の複数選択。行全体が 48px のクリック領域。 |
| `Chip` / `ChipGroup` | `selected?`、`icon?`。Group: `label` | オンとオフを切り替える絞り込みや補助のピル（`aria-pressed`）。`bb-chips` の中で折り返します。 |
| `Dialog` | `open`、`onClose`、`title`、`description?`、`icon?`、`actions?`、`role?`（`'dialog'\|'alertdialog'`） | 答えを求める、画面をふさぐモーダル。フォーカスを閉じ込め、Esc とスクリムで閉じ、閉じるとフォーカスを戻します。 |
| `FAB` | `variant`（`'primary'\|'secondary'\|'tertiary'`）、`icon`、`label`、`extended?` | 画面右下に置く、画面で一番大事な操作 1 つ（はじめは `extended` がおすすめ）。 |
| `IconButton` | `variant`（`'standard'\|'filled'\|'tonal'\|'outlined'`）、`label`（必須）、`pressed?`、`icon?` | 48×48px の小さなアイコン操作かトグル（`aria-pressed`）。 |
| `List` / `ListItem` / `Avatar` | List: `selectable?`、`label?`。Item: `headline`、`supportingText?`、`leading?`、`trailing?`、`selected?`、`onSelect?` | 高さ 72px の行。40px のピクセル `Avatar` と、桁をそろえた右端のメタ情報を持ちます。 |
| `NavigationBar` | `items`（`{ id, label, icon, badge?, badgeLabel? }`）、`activeId`、`onSelect`、`label?` | 3〜5 個のトップレベルの行き先。ラベルは常に表示し、件数か `'dot'` のバッジを付けられます。 |
| `Progress` | `label`、`value?`、`max?`、`valueLabel?`、`variant?`（`'primary'\|'success'`） | 区切り付きの進捗バー（`value` を省くと、コマ送りで進む不確定の表示）。 |
| `Radio` / `RadioGroup` | Group: `legend`、`name`、`value?`、`defaultValue?`、`onChange?`、`options?`。Radio: `value`、`label` | `fieldset` の中で、2〜4 個から 1 つを選ぶ（5 個以上は `List` を使います）。 |
| `Slider` | `label`、`value?`、`defaultValue?`、`min?`、`max?`、`step?`、`formatValue?`、`onChange?` | 範囲から値を選ぶ。常に見えるテキストの値と、`--val` の塗りつぶし付き。 |
| `Snackbar` | `open?`、`message`、`actionLabel?`、`onAction?`、`onDismiss?`、`durationMs?` | 一時的なフィードバック（`role="status"`）。自動で閉じるのは、操作がなく 6 秒以上のときだけ。 |
| `Switch` | `label`、`checked?`、`defaultChecked?`、`onChange?`、`onLabel?`、`offLabel?` | すぐに効くオンとオフの設定（`role="switch"`）。`On` / `Off` の文字をはっきり表示します。 |
| `Tabs` | `label`、`tabs`（`{ id, label, icon?, panel?, disabled? }`）、`activeId?`、`defaultActiveId?`、`onChange?` | 同じ重みの 2〜5 個のビュー。矢印キーで roving `tabIndex` が動き、Enter と Space で選びます。 |
| `Tag` | `hue?`（`'neutral'` か 16 色の hue）、`solid?`、`icon?`、`children` | 操作できないカテゴリー、レア度、状態のピル。色は必ず文字と組にします。 |
| `TextField` | `label`、`helperText?`、`error?`（`string \| boolean`）、`leadingIcon?` | 1 行の入力欄。上に常にラベルがあり、エラーは次の行動がわかる文にします。 |
| `Surface` | `label?`、`children?` | 意味を持つ `<section class="bb-surface">` の入れ物。 |
