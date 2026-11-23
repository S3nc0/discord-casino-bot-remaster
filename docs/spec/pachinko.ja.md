[English](pachinko.md) | **日本語**

# パチンコ（`pachinko`）

玉を打ち出すパチンコ台です（`/カジノ パチンコ`）。1 セット ＝ 100 発で、1〜10 セットの連続プレイに対応します。
共通契約との整合：`GameId = 'pachinko'`、`ScreenId = 'pachinko'`、`LEDGER_REASONS`（`game_stake`、`game_payout`、`game_refund`、`jackpot_payout`、`debt_withholding`）。[casino-common.ja.md](./casino-common.ja.md) を参照してください。

## 元ファイル

- `catalogs/games.yaml:97-150,151-155`
- `catalogs/skins.yaml:54-69,98-105`
- `docs/casino.md:24-35`
- `legacy/python/domain/games/pachinko.py:1-211`
- `legacy/python/domain/games/rtplevel.py:76-79,85`
- `legacy/python/infra/db/pachinko.py:1-71`
- `legacy/python/cogs/casino/cog.py:65-78`
- `legacy/python/cogs/casino/pachinko.py:1-431`
- `legacy/python/cogs/casino/texts.py:122-194`

## ルールと正確な数値

### 1 セットの仕組み（`roll_set`）
- `BALLS_PER_SET = 100`、`P_START = 0.07`（玉 1 発ずつ独立に、`rng.random() < 0.07` でスタートチャッカーに入ります。1 セットで平均 7 回転）。
- `MAX_SETS = 10`。複数セットのプレイは、`total = bet * sets` を 1 つのエスクローとして賭け、ミッション、連勝、週間ランキングでは 1 回のプレイとして数えます。
- スタートに入るたびに（`roll_spin`）：
  1. `OMEN_TABLE` から `omen` を引きます：
     - `""`（なし）：確率 `0.75`、ボーナス `0.000`
     - `"blue"`：確率 `0.15`、ボーナス `0.002`
     - `"red"`：確率 `0.08`、ボーナス `0.010`
     - `"gold"`：確率 `0.02`、ボーナス `0.080`
  2. `TIER_TABLE` から `tier`（リーチの格）を引きます：
     - `""`（リーチなし）：確率 `0.85`、ボーナス `0.00`
     - `"normal"`：確率 `0.10`、ボーナス `0.01`
     - `"super"`：確率 `0.04`、ボーナス `0.12`
     - `"premium"`：確率 `0.01`、ボーナス `0.45`
  3. 当選確率（`hit_probability(omen, tier)`）：
     - `HIT_TARGET = 0.01322`。
     - `extra = sum(p_o * b_o) + sum(p_t * b_t) = (0.15*0.002 + 0.08*0.01 + 0.02*0.08) + (0.10*0.01 + 0.04*0.12 + 0.01*0.45) = 0.0027 + 0.0103 = 0.0130`。
     - `BASE_HIT = 0.01322 - 0.0130 = 0.00022`。
     - `prob = min(1.0, BASE_HIT + omen_bonus + tier_bonus)`。
     - `rng.random() < prob` なら当選です。
  4. 当選したら、確変の連チャンを引きます（`roll_rounds`）：
     - ループ：`ROUNDS` からラウンドの倍率を引いて追加し、`rng.random() >= CONTINUE`（`CONTINUE = 0.50`。幾何分布で平均 2 ラウンド）で止めます：
       - `小当たり`：`mult = 2`、`prob = 0.695`
       - `大当たり`：`mult = 10`、`prob = 0.265`
       - `激アツ確変`：`mult = 30`、`prob = 0.040`
     - 1 ラウンドの期待倍率：`2*0.695 + 10*0.265 + 30*0.04 = 1.39 + 2.65 + 1.20 = 5.24`。
     - 連チャン全体の期待倍率：`5.24 / (1 - 0.50) = 10.48`。
- セットの倍率：`raw = sum(s.raw for s in spins)`（上限なし）。

### オッズ、RTP、複数セットの RTP 調整
- 厳密な DP の分布（`_set_distribution`、`ANALYSIS_MAX = 400`、二項分布 `m = 0..30`、`q = P_START * mean_hit_prob()`）：
  - `mean_hit_prob() = 0.01322`（厳密）。
  - `hit_rate() ≈ 0.08843`（セットの約 8.84% で、少なくとも 1 回当たる）。
  - `rtp() ≈ 0.9704`（レベル 3 での基本 RTP は約 97.04%）。
- **複数セットの RTP のルール（重要）**（`cogs/casino/pachinko.py:387-391`）：
  - RTP レベルの調整は、合計する**前に、セットごとに**適用します：`adjusted = [rtplevel.adjust("パチンコ", level, bet, bet * r.mult) for r in results]`。
  - `settle()` は `sum(adjusted)` と `rtp_done=True` で呼ばれます（`CasinoService.settle_game` は再調整しません）。
  - 突発イベントのボーナスは、合計 `(total_bet, sum(adjusted))` に対して 1 回だけ適用し、`10,000` で頭打ちにします。
- 統計の記録（`infra/db/pachinko.py:21-46`）：`/運営 パチンコ統計` のために、すべてのセット（`pachinko_sets`）とすべてのスピン（`pachinko_spins`）を記録します（DB の失敗は致命的ではありません）。

### リールとアニメーションのルール（見た目だけ）
- 結果はアニメーションの再生の**前に**計算され、精算されます（`keep_session=True`、`finally` で解放）。
- `REEL_SYMBOLS`：`["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "🔥"]`、`SMALL = ["1️⃣", "2️⃣", "3️⃣"]`、`MEDIUM = ["4️⃣", "5️⃣", "6️⃣"]`。
- `pick_reels(round_mult, tier, rng)`：
  - `mult == 2` → `SMALL` からランダムに 3 つ揃い。`mult == 10` → `("7️⃣",)*3`。`mult >= 30` → `("🔥",)*3`。
  - リーチありのハズレ（`tier != ""`）→ `(s, s, other)`。リーチなしのハズレ → 3 つとも違う図柄。
- アニメーションするのは、当たったスピン（`hit_spins`）だけです。フレームの予算は `FRAME_BUDGET = 60`（`PACHINKO_STEP_SECONDS = 1.1s` で約 66 秒）。
- `PSEUDO_COUNTS`：`super: [0, 0, 1, 2]`、`premium: [2, 3, 3, 4]`。
- `REVIVE_CHANCE`（当たりのときだけ）：`normal: 0.10`、`super: 0.25`、`premium: 0.30`。
- `SHOWN_ROUNDS = 6`（個別のラウンドのフレーム）。`> 6` の連チャンは、節目の表示（`10連 突破！！` / `20連 突破！！！`）にまとめます。
- 複数セットのアニメーションは、当たったセットを `mult` の大きい順に、`FRAME_BUDGET` まで表示します。
- 追加のリプレイのボタン（`PachinkoView`）：`sets < 5` なら `×5連続`、`5 <= sets < 10` なら `×10連続` を出します。

## 状態機械

```text
IDLE -> [start_game(bet * sets): lock + escrow] -> RESOLVED_AND_SETTLED
RESOLVED_AND_SETTLED -> [record_pachinko_set] -> ANIMATING (1.1s/frame, <=60 frames)
ANIMATING -> [final embed + PachinkoView(90s)] -> RELEASED (session unlocked)
```

## エッジケース

- `sets` は `max(1, min(int(sets), 10))` に収めます。
- スタートへの入賞がゼロ（`starts == 0`）なら、スピンはゼロで `mult = 0` です。
- 1 セットの中で複数回当たっても、上限なしで全部足します。
- アニメーションの Discord の編集が失敗しても（`discord.HTTPException`）、精算はすでに成功しており、セッションは `finally` で解放されます。
- 結果の埋め込みの色：`top_round >= 10` なら `ui.GOLD`、そうでなく `net > 0` なら `ui.OK`、それ以外は `ui.ERROR`。

## ユーザーに表示する日本語文言

| キー | 原文 | 出典 |
|---|---|---|
| `pachinko.cmd.desc` | `🎰 玉を打ち出して、入った数だけ回転。当たれば連チャン` | `cogs/casino/cog.py:65` |
| `pachinko.bet.desc` | `1セット（100発）の賭け金` | `cogs/casino/cog.py:68` |
| `pachinko.sets.desc` | `連続で打つセット数（1〜10。省略で1）。賭け金×回数が上限以内` | `cogs/casino/cog.py:69` |
| `pachinko.title` | `🎰 地下パチンコ` | `cogs/casino/texts.py:122` |
| `pachinko.round.small` | `小当たり` | `catalogs/games.yaml:106` |
| `pachinko.round.big` | `大当たり` | `catalogs/games.yaml:109` |
| `pachinko.round.kakuhen` | `激アツ確変` | `catalogs/games.yaml:112` |
| `pachinko.banner.10` | `# 🎊 大当たり！！ 🎊` | `cogs/casino/texts.py:131` |
| `pachinko.banner.30` | `# 🔥🔥 激アツ確変！！！ 🔥🔥` | `cogs/casino/texts.py:132` |
| `pachinko.rank.100` | `👑 伝説級` | `cogs/casino/texts.py:136` |
| `pachinko.rank.30` | `🏆 大勝利` | `cogs/casino/texts.py:137` |
| `pachinko.rank.10` | `🎊 好調` | `cogs/casino/texts.py:138` |
| `pachinko.rank.0` | `✨ 小当たり` | `cogs/casino/texts.py:139` |
| `pachinko.omen.blue` | `（青）ざわ…` | `cogs/casino/texts.py:143` |
| `pachinko.omen.red` | `（赤）ゾワッ…！ 予告だ…！` | `cogs/casino/texts.py:144` |
| `pachinko.omen.gold` | `（金）⚡ 激アツ予告 ⚡ これは来る…！` | `cogs/casino/texts.py:145` |
| `pachinko.step.0..2` | `ざわ…` / `ゾワッ…！` / `⚡ 激アツ ⚡` | `cogs/casino/texts.py:148` |
| `pachinko.cutin.super` | `「チャンスだ！！」` / `「いけるぞ！！」` / `「ここからが本番だ！」` / `「見せてやる！！」` | `cogs/casino/texts.py:157` |
| `pachinko.cutin.premium` | `「これで終わりだ！！」` / `「全部まとめて持っていけ！！」` / `「運命を変えろ！！」` / `「勝負だ！！」` | `cogs/casino/texts.py:158` |
| `pachinko.story.normal` | `🌊 **波の予告**`（`画面が揺れている…`） / `🐟 **魚群が横切った**`（`なにか起きる…？`） / `🎞️ **ロングリーチ**`（`ゆっくり回っている…`） | `cogs/casino/texts.py:162-166` |
| `pachinko.story.super` | `🎬 **ストーリーリーチ**`（`主人公が立ち上がる…！`） / `🚄 **ダッシュリーチ**`（`絵柄が走り出した…！`） / `⚡ **スーパーリーチ**`（`背景が変わった…！`） | `cogs/casino/texts.py:167-171` |
| `pachinko.story.premium` | `🐉 **龍が現れた**`（`地鳴りがする…！！`） / `🌠 **流星群**`（`夜空が光る…！`） / `🔥 **プレミアムリーチ**`（`画面が燃えている…！！`） | `cogs/casino/texts.py:172-176` |
| `pachinko.whisper` | `ざわ… ざわ…` / `じわ… じわ…` / `…どっちだ…` | `cogs/casino/texts.py:179` |
| `pachinko.revive.0..3` | `それでも!!!`（`…諦めない…！！`） / `と、思っていたのか`（`…画面が震えている…！！`） / `まだ終わっていない…！`（`…リールが動き出す…！`） / `ここからだ…！！`（`…運命が書き換わる…！`） | `cogs/casino/texts.py:181-186` |
| `pachinko.flavor.miss` | `…沈黙。ペリカが静かに溶けていく…` | `cogs/casino/texts.py:189` |
| `pachinko.flavor.small` | `ッ…！ 拾った…少しだけ…` | `cogs/casino/texts.py:190` |
| `pachinko.flavor.big` | `ざわ…ざわ…ざわ…！ 大当たり…！ 見ろ、この出玉…！` | `cogs/casino/texts.py:191` |
| `pachinko.flavor.kakuhen` | `どよめき…！ 確変突入…！ 地下が揺れる…！！` | `cogs/casino/texts.py:192` |
| `pachinko.start` | `玉を弾く…ざわ… ざわ…` | `cogs/casino/pachinko.py:407` |
| `pachinko.starts` | `**100発** のうち **{starts}発** がスタートに入った！` | `cogs/casino/pachinko.py:253` |
| `pachinko.starts.go` | `リールが回り出す…` | `cogs/casino/pachinko.py:254` |
| `pachinko.starts.none` | `…今回は1回も入らなかった…` | `cogs/casino/pachinko.py:254` |
| `pachinko.all_miss` | `**{starts}回転**、すべてハズレ…` | `cogs/casino/pachinko.py:264` |
| `pachinko.reach_miss` | `（リーチが **{reach}回** あったが、外れた）` | `cogs/casino/pachinko.py:265` |
| `pachinko.freeze` | `💫 **フリーズ！！** 💫` / `画面が固まった…！！` | `cogs/casino/pachinko.py:179` |
| `pachinko.reach` | `**リーチ！**` | `cogs/casino/pachinko.py:187` |
| `pachinko.slow` | `⚡ スローになった… ⚡` / `…ここで決まる…！` | `cogs/casino/pachinko.py:204` |
| `pachinko.zenkaiten` | `🔥🔥 **全回転！！** 🔥🔥` / `すべての絵柄が光る…！！` | `cogs/casino/pachinko.py:208` |
| `pachinko.chain_end` | `✨ **連チャン終了** ✨\n**{n}連**　出玉 **+{raw}倍**\n{rank}` | `cogs/casino/pachinko.py:235` |
| `pachinko.btn.extra` | `🎰 ×{extra}連続（{total:,}）` | `cogs/casino/pachinko.py:366` |
