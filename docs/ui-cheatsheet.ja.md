[English](ui-cheatsheet.md) | **日本語**

# Bitbloom UI チートシート（`@casino/ui`）

`@casino/ui` から import します（自前で配信するフォント、`tokens.css`、`bundle.css` は自動で読み込まれ、外部 URL は一切使いません）。

## セットアップ

アプリのルートを `<ThemeProvider>` で包みます（`theme?: 'light' | 'dark' | 'discord'` は既定が `'discord'`、`discordTheme?: 'light' | 'dark'`、`reducedMotion?: boolean | 'system' | 'reduce' | 'no-preference'`）。状態は `useTheme()` で読みます。

## デザインのルール

- **まず読みやすさ:** 本文は Atkinson Hyperlegible（`--font-body`。日本語のシステムフォントのフォールバック付き）を **16px 以上**（`body-medium`）で使います。`label-small`（12px）はバッジ専用です。文は常に sentence case です。
- **Pixelify は見出しだけ:** Pixelify Sans（`--font-display`）は、Display、Headline、Title のスタイル（56 → 16px）にだけ使います。
- **数字は Atkinson、Pixelify は使わない:** Pixelify Sans は、どのサイズでも 2 を 8 に、5 を S に似せて描きます（12,400 が 18,400 に見えます）。お金、オッズ、順位、タイマー、個数は `.num` クラス（`--font-numeric` = Atkinson Hyperlegible、`tabular-nums`）で表示します。見出しなど Pixelify の文字列に混ざる数字（「Race 12」）は、`--font-display` の先頭にある `Bitbloom Numerals` が受け持つので、個別の上書きは要りません。
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
| `ScrollFade` | `revealSelector?`、`children` | 収まらないときに横にスクロールする行で、まだ隠れたものがある端をやわらかくぼかします（チップの行）。最初に選択中の子を見える位置まで動かします。 |

## ドット絵

ドット絵はすべて `tools/pixel-art/` が作るデータです（[MAINTAINERS.ja.md](../MAINTAINERS.ja.md#ドット絵を作り直す) を参照）。手で直さないでください。色はパレットのトークンなので、ライトとダークが同じ行から描かれます。どの絵も、`label` を渡さなければ飾り（`aria-hidden`）です。動きを減らす設定では、どのアニメーションも止まった絵になります。

| エクスポート | 主なプロパティ | 使いどころ |
| --- | --- | --- |
| `GameIcon` | `name`（`GameIconName`、36 種）、`label?`、`bob?` | タイルや見出しのゲームや機能のアイコン。16×16 の絵を整数倍の大きさで。 |
| `Skyline` | `variant?`（`'night'\|'day'`。テーマに従う） | ホームのヒーローの後ろのドット絵の街。 |
| `Sparkle` | `twinkle?` | ごほうびの小さなきらめき（`tertiary`）。 |
| `PixelScene` | `art`（`SceneArt`）、`frame?`、`scale?`（整数）、`label?`、`children?` | 画面の場面を、くっきりした整数倍の大きさで。上に重ねる層も置けます。 |
| `SceneLayer` | `art`、`frame?`、`x?`、`y?`、`flip?` | `PixelScene` の中に置くスプライト（馬房の馬の肖像、闘技場の戦士）。 |
| `PixelTile` | `art`、`scale?` | 箱全体に繰り返す絵（芝、壁紙）。 |
| `useSceneFrame` | `(count, ms, play?)` | くり返す絵のコマ番号。止めているときと、動きを減らす設定では 0。 |
| `useSceneOnce` | `{ frames, ms, trigger?, rest?, onMount? }` | 求めたときに 1 回だけ動く絵（正解の演出、プレゼントが開く）のコマ番号。終わると止まった絵に戻ります。 |

`SceneArt` は `{ w, h, legend, frames }` です。各コマは行の文字列の並びで、`legend` は文字をパレットのトークン名の組 `[ライト, ダーク]` に対応させます。画面専用の場面の入れ物（`CasinoScene`、`FinanceScene`）は、`apps/web` の画面の隣にあります。
