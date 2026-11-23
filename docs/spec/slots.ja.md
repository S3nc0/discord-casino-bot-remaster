[English](slots.md) | **日本語**

# スロット（`slots`）

重み付きの 3 リールのスロットです（`/カジノ スロット`）。
共通契約との整合：`GameId = 'slots'`、`ScreenId = 'slots'`、`LEDGER_REASONS`（`game_stake`、`game_payout`、`game_refund`、`jackpot_payout`、`debt_withholding`）。[casino-common.ja.md](./casino-common.ja.md) を参照してください。

## 元ファイル

- `catalogs/games.yaml:13-35,151-155`
- `catalogs/skins.yaml:113-119`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/games/slot.py:1-55`
  - `domain/games/rtplevel.py:32-45,83`
  - `cogs/casino/cog.py:80-85`
  - `cogs/casino/simple.py:30-88`
  - `cogs/casino/texts.py:8`

## ルールと正確な数値

### 図柄の重みと配当表（`catalogs/games.yaml:13-35`）
重みの合計は `10 + 8 + 6 + 4 + 2 + 1 = 31` です。3 つのリールは、それぞれ独立に、重複ありで引きます（`rng.choices(SYMBOLS, weights=..., k=3)`）。

| 図柄 | 重み | 1 リールでの確率 | 3 つ揃いの確率 | 3 つ揃いの倍率 |
|---|---|---|---|---|
| `🍒` | `10` | `10/31` | `1000/29791` | `5×` |
| `🍋` | `8` | `8/31` | `512/29791` | `8×` |
| `🍇` | `6` | `6/31` | `216/29791` | `15×` |
| `🔔` | `4` | `4/31` | `64/29791` | `30×` |
| `💎` | `2` | `2/31` | `8/29791` | `100×` |
| `7️⃣` | `1` | `1/31` | `1/29791` | `500×` |

3 つ揃い以外のチェリーの配当（`multiplier(reels)`）：
- `🍒` がちょうど 2 つ：`1.5×`（`CHERRY_TWO = 1.5`）。
- `🍒` がちょうど 1 つ：`0.3×`（`CHERRY_ONE = 0.3`）。
- それ以外：`0×`。

### 配当の丸め、オッズ、RTP
- `payout = int(bet * slot.multiplier(reels))`（整数への切り捨て）。
- 正確な基本 RTP（`slot.rtp()`。重み付きの `31^3 = 29,791` 通りの出目すべてについて）：
  - 3 つ揃い：`(1000*5 + 512*8 + 216*15 + 64*30 + 8*100 + 1*500) / 29791 = 15556 / 29791 ≈ 0.522171`
  - チェリー 2 つ：`3 * 10 * 10 * 21 * 1.5 / 29791 = 9450 / 29791 ≈ 0.317210`
  - チェリー 1 つ：`3 * 10 * 21 * 21 * 0.3 / 29791 = 3969 / 29791 ≈ 0.133228`
  - **基本 RTP の合計** ＝ `28975 / 29791 ≈ 0.972609`（97.26%）。
  - 注：`CHERRY_ONE`（0.3×）は `payout < bet` を返すので `net < 0` で、保険は発動せず（`payout != 0`）、RTP レベルによる変更も受けません（`payout <= bet`）。
  - 勝ちの取り分 `SLOT_W = sum(p * max(0, m - 1)) ≈ 0.659461`。

### 上限とタイマー
- `MIN_BET = 10`、上限なし。
- アニメーション：`SIMPLE_STEP_SECONDS = 0.9s` ごとの、リールが止まる 3 フレーム（合計約 2.7 秒）。アニメーションの前に精算します（`keep_session=True`、`finally` で解放）。
- リプレイのボタンのタイムアウト：`90s`。

## 状態機械

```text
IDLE -> [start_game: lock + escrow] -> SPIN_AND_SETTLE
SPIN_AND_SETTLE -> [frame 0: 🌀🌀🌀 -> 0.9s -> r0🌀🌀 -> 0.9s -> r0r1🌀 -> 0.9s -> final] -> RELEASED
```

## エッジケース

- `bet = 10` でチェリー 1 つ（`0.3×`）：`payout = int(10 * 0.3) = 3`、`net = -7`、`lost = 7`（銀行の損失の取り分は `int(7 * 0.03) = 0`、ジャックポットは `int(7 * 0.05) = 0`）。
- 保険券の消耗品は、チェリー 1 つのときは発動しません（`payout > 0`）。`payout == 0` のときだけ発動します。
- 埋め込みの色：`net > 0` なら `ui.OK`、`net == 0` なら `ui.INFO`、`net < 0` なら `ui.ERROR`。`net >= bet * 10` なら `ui.GOLD` に上がります。

## ユーザーに表示する日本語文言

| キー | 原文 | 出典 |
|---|---|---|
| `slots.cmd.desc` | `🍒 3つのリール。揃えれば大きく増える` | `cogs/casino/cog.py:80` |
| `slots.title` | `🎰 スロット` | `cogs/casino/simple.py:66` |
| `slots.label.777` | `7️⃣ 大当たり！！` | `domain/games/slot.py:36` |
| `slots.label.triple` | `{symbol} 3つ揃い！` | `domain/games/slot.py:36` |
| `slots.label.cherry2` | `🍒🍒 チェリー2つ` | `domain/games/slot.py:39` |
| `slots.label.cherry1` | `🍒 チェリー（少し戻り）` | `domain/games/slot.py:41` |
| `slots.label.miss` | `ハズレ` | `domain/games/slot.py:42` |
| `slots.result.title` | `{title} — {signed_net}ペリカ` | `cogs/casino/simple.py:69` |
