[English](blackjack.md) | **日本語**

# ブラックジャック（`blackjack`）

1 デッキのブラックジャック（`/カジノ ブラックジャック`）です。ヒット、スタンド、ダブルダウン（帝愛の信用を使ったダブルを含む）があり、スプリットとインシュランスはありません。
共通契約との整合：`GameId = 'blackjack'`、`ScreenId = 'blackjack'`、`LEDGER_REASONS`（`game_stake`、`game_payout`、`game_refund`、`jackpot_payout`、`debt_withholding`、`loan_borrow`）。[casino-common.ja.md](./casino-common.ja.md) を参照してください。

## 元ファイル

- `catalogs/games.yaml:70-73,151-159`
- `catalogs/skins.yaml:54-61,106-112`
- `docs/teiai.md:15`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/games/blackjack.py:1-98`
  - `domain/games/rtplevel.py:28,87`
  - `infra/db/escrow.py:51-76`
  - `cogs/casino/cog.py:87-92`
  - `cogs/casino/blackjack.py:1-219`
  - `cogs/casino/texts.py:24-36`

## ルールと正確な数値

### デッキと配り方（`new_deck`、`Game.__post_init__`）
- 標準の 52 枚の 1 デッキ：4 つのスート（`♠`、`♥`、`♦`、`♣`）× 13 のランク（`A`、`2`〜`10`、`J`、`Q`、`K`）。`rng.shuffle(deck)` でシャッフルします。
- 配る順番（末尾から `deck.pop()`）：
  - `player = [pop(), pop()]`
  - `dealer = [pop(), pop()]`（`dealer[0]` は表向き、`dealer[1]` はプレイ中は `？` と伏せます）。
- 手札の評価（`value(cards)`）：`A = 11`（`total > 21` の間、1 枚ずつ `1` に切り替え）、`J/Q/K = 10`、数字のランクはそのまま。
- ナチュラルブラックジャック（`is_blackjack`）：`len(cards) == 2 and value(cards) == 21`。
  - 最初の配りで `player` か `dealer` のどちらかがナチュラルなら、すぐに `finished = True` になります（プレイヤーの操作はありません）。

### プレイヤーの操作とディーラーのルール
- **ヒット（`hit`）**：`player` に 1 枚足します。`value(player) >= 21` なら自動で `stand()` を呼びます。最初のヒットのあとはダブルのボタンが無効になります。
- **スタンド（`stand`）**：`value(dealer) < 17 and value(player) <= 21` の間、`dealer` に 1 枚足します（ディーラーはソフト 17 を含むすべての 17 で止まります）。`finished = True` にします。
- **ダブル（`double`）**：`len(player) == 2 and not doubled` のときだけ選べます。
  - 現金から `add_to_escrow(gid, eid, bet)` を試みます。
  - 現金が足りなければ `need = bet - balance` を計算し、`teiai.can_borrow_for_bet(gid, uid, need)` を確認します（破産していない、破産猶予中でない、`need <= teiai.SEED` = `3,000`）。
  - 借りられるなら確認のモーダル（`confirm_action`）を出します。確認されたら `add_to_escrow(..., credit=True)` を呼び、帝愛から `need` を借りて（債務と地下労働者の状態ができます）、`bet` をエスクローに足します。
  - `doubled = True` にして、`player` に 1 枚だけ足し、`stand()` を呼びます。

### 決着と配当（`result`、`payout`）
`Game.result()` の優先順位：
1. `is_blackjack(player)` → `is_blackjack(dealer)` なら `"push"`、そうでなければ `"blackjack"`。
2. `is_blackjack(dealer)` → `"lose"`。
3. `p > 21` → `"bust"`。
4. `d > 21 or p > d` → `"win"`。
5. `p == d` → `"push"`、そうでなければ `"lose"`。

配当（`bet` はダブル分を含むエスクローの合計）：
- `"blackjack"`：`bet * 5 // 2`（3:2。奇数の賭け金は整数で切り捨て）。
- `"win"`：`bet * 2`。
- `"push"`：`bet`。
- `"lose"` / `"bust"`：`0`。

### ミッションのタグ
- `result == "blackjack"` のとき `"natural"` を付けます。
- `result in ("win", "blackjack") and game.doubled` のとき `"double_win"` を付けます。

### オッズと RTP
- 基本の RTP プロファイル（`rtplevel.py:28`）：`BLACKJACK_RTP = 0.918`、`BLACKJACK_W = 0.412`（基準の戦略は 17 までヒット）。
- レベル 1〜6 のおよその RTP：`83.8%` / `87.8%` / `91.8%` / `95.8%` / `99.8%` / `103.8%`。

### 上限とタイマー
- `MIN_BET = 10`、上限はありません。
- `BlackjackView` のタイムアウト：`90s`。タイムアウトすると自動でスタンド（`game.stand()`）して精算します。
- リプレイのビューのタイムアウト：`90s`。リプレイには `base_bet`（ダブル前の元の賭け金）を使います。

## 状態機械

```text
IDLE -> [start_game: lock + escrow] -> DEAL
DEAL -> [natural BJ on either side] -> SETTLED (immediate)
DEAL -> [no natural] -> PLAYER_FIRST_TURN (Hit / Stand / Double, 90s)
PLAYER_FIRST_TURN -> [Hit & total < 21] -> PLAYER_HIT_TURN (Hit / Stand, Double disabled)
PLAYER_FIRST_TURN -> [Hit & total >= 21] -> DEALER_PLAY -> SETTLED
PLAYER_FIRST_TURN -> [Double (cash or Teiai credit confirm)] -> DEALER_PLAY -> SETTLED
PLAYER_FIRST_TURN / PLAYER_HIT_TURN -> [Stand OR timeout 90s] -> DEALER_PLAY -> SETTLED
```

## エッジケース

- ヒットかダブルでプレイヤーがバースト（`p > 21`）したときは、ディーラーは引き**ません**（`stand()` の `value(player) <= 21` のガード）。
- 奇数の賭け金でナチュラルブラックジャックのときは、`bet * 5 // 2` で切り捨てます（例：`bet = 11` → `payout = 27`）。
- 帝愛の信用でダブルする確認の最中に、ゲームがタイムアウトするか、確認の前に終わった場合は、信用の呼び出しを中止します（`blackjack.py:191-198`）。
- ダブルで勝つと、結果の埋め込みの色が `ui.GOLD` になります。
- リプレイのボタンは `self.base_bet`（ダブル後の賭け金ではない）を使います。

## ユーザーに表示する日本語文言

| キー | 原文 | 出典 |
|---|---|---|
| `blackjack.cmd.desc` | `🃏 21に近づけてディーラーに勝つ（ヒット・スタンド・ダブル）` | `cogs/casino/cog.py:87` |
| `blackjack.title` | `🃏 ブラックジャック` | `cogs/casino/texts.py:24` |
| `blackjack.res.blackjack` | `ブラックジャック！ 3:2 で払い戻し🎉` | `cogs/casino/texts.py:27` |
| `blackjack.res.win` | `勝ち🎉` | `cogs/casino/texts.py:28` |
| `blackjack.res.dealer_bust` | `ディーラーがバースト！ 勝ち🎉` | `cogs/casino/blackjack.py:109` |
| `blackjack.res.push` | `引き分け（賭け金が戻る）` | `cogs/casino/texts.py:29` |
| `blackjack.res.lose` | `負け…` | `cogs/casino/texts.py:30` |
| `blackjack.res.bust` | `バースト…（21を超えた）` | `cogs/casino/texts.py:31` |
| `blackjack.flair.blackjack` | `🃏✨ **ナチュラルブラックジャック！** 最初の2枚で21！` | `cogs/casino/texts.py:34` |
| `blackjack.flair.doubled` | `💥 **ダブルダウン成功！** 倍賭けが当たった！` | `cogs/casino/texts.py:35` |
| `blackjack.flair.21` | `🎯 **21ぴったり！**` | `cogs/casino/texts.py:36` |
| `blackjack.btn.hit` | `ヒット（もう1枚）` | `cogs/casino/blackjack.py:148` |
| `blackjack.btn.stand` | `スタンド（勝負）` | `cogs/casino/blackjack.py:155` |
| `blackjack.btn.double` | `ダブル（倍賭けして1枚）` | `cogs/casino/blackjack.py:162` |
| `blackjack.err.double_title` | `ダブルできません` | `cogs/casino/blackjack.py:170` |
| `blackjack.err.double_first_only` | `ダブルは、最初の2枚のときだけ選べます。` | `cogs/casino/blackjack.py:170` |
| `blackjack.err.double_no_credit` | `倍にするためのペリカが足りません。{reason}` | `cogs/casino/blackjack.py:180` |
| `blackjack.err.double_borrow_fail` | `帝愛から借りられませんでした。` | `cogs/casino/blackjack.py:201` |
| `blackjack.credit.title` | `帝愛の信用でダブルしますか？` | `cogs/casino/blackjack.py:186` |
| `blackjack.credit.body` | `手元が **{need:,}ペリカ** 足りません。足りない分を帝愛から借りて、倍賭けします。\n**借金になり、🟡地下労働者に落ちます**（デイリーのピンハネ・収入の天引きが始まります）。` | `cogs/casino/blackjack.py:187-188` |
| `blackjack.credit.btn` | `借りてダブル` | `cogs/casino/blackjack.py:189` |
| `blackjack.label.doubled` | `　ダブルダウン` | `cogs/casino/blackjack.py:114` |
