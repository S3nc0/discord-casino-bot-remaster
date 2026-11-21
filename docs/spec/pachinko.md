# Pachinko (`pachinko`)

Ball-firing pachinko machine (`/カジノ パチンコ`). 1 set = 100 balls; supports 1–10 consecutive sets.
Shared contract alignment: `GameId = 'pachinko'`, `ScreenId = 'pachinko'`, `LEDGER_REASONS` (`game_stake`, `game_payout`, `game_refund`, `jackpot_payout`, `debt_withholding`). See [casino-common.md](./casino-common.md).

## Source Files

- `catalogs/games.yaml:97-150,151-155`
- `catalogs/skins.yaml:54-69,98-105`
- `docs/casino.md:24-35`
- `legacy/python/domain/games/pachinko.py:1-211`
- `legacy/python/domain/games/rtplevel.py:76-79,85`
- `legacy/python/infra/db/pachinko.py:1-71`
- `legacy/python/cogs/casino/cog.py:65-78`
- `legacy/python/cogs/casino/pachinko.py:1-431`
- `legacy/python/cogs/casino/texts.py:122-194`

## Rules & Exact Numbers

### Per-Set Mechanics (`roll_set`)
- `BALLS_PER_SET = 100`, `P_START = 0.07` (each ball independently enters start pocket with `rng.random() < 0.07`; average 7 spins/set).
- `MAX_SETS = 10`. Multi-set play wagers `total = bet * sets` as a single escrow and counts as 1 game play for missions, streaks, and weekly ranking.
- For each start entry (`roll_spin`):
  1. Draw `omen` from `OMEN_TABLE`:
     - `""` (none): prob `0.75`, bonus `0.000`
     - `"blue"`: prob `0.15`, bonus `0.002`
     - `"red"`: prob `0.08`, bonus `0.010`
     - `"gold"`: prob `0.02`, bonus `0.080`
  2. Draw `tier` (reach grade) from `TIER_TABLE`:
     - `""` (no reach): prob `0.85`, bonus `0.00`
     - `"normal"`: prob `0.10`, bonus `0.01`
     - `"super"`: prob `0.04`, bonus `0.12`
     - `"premium"`: prob `0.01`, bonus `0.45`
  3. Hit probability (`hit_probability(omen, tier)`):
     - `HIT_TARGET = 0.01322`.
     - `extra = sum(p_o * b_o) + sum(p_t * b_t) = (0.15*0.002 + 0.08*0.01 + 0.02*0.08) + (0.10*0.01 + 0.04*0.12 + 0.01*0.45) = 0.0027 + 0.0103 = 0.0130`.
     - `BASE_HIT = 0.01322 - 0.0130 = 0.00022`.
     - `prob = min(1.0, BASE_HIT + omen_bonus + tier_bonus)`.
     - Hit if `rng.random() < prob`.
  4. On hit, roll kakuhen chain (`roll_rounds`):
     - Loop: draw round multiplier from `ROUNDS`, append; stop when `rng.random() >= CONTINUE` (`CONTINUE = 0.50`, geometric mean = 2 rounds):
       - `小当たり`: `mult = 2`, `prob = 0.695`
       - `大当たり`: `mult = 10`, `prob = 0.265`
       - `激アツ確変`: `mult = 30`, `prob = 0.040`
     - Expected single round multiplier: `2*0.695 + 10*0.265 + 30*0.04 = 1.39 + 2.65 + 1.20 = 5.24`.
     - Expected chain multiplier: `5.24 / (1 - 0.50) = 10.48`.
- Set multiplier: `raw = sum(s.raw for s in spins)` (uncapped).

### Odds, RTP & Multi-Set RTP Adjustment
- Exact DP distribution (`_set_distribution`, `ANALYSIS_MAX = 400`, binomial `m = 0..30`, `q = P_START * mean_hit_prob()`):
  - `mean_hit_prob() = 0.01322` (exact).
  - `hit_rate() ≈ 0.08843` (~8.84% of sets hit at least once).
  - `rtp() ≈ 0.9704` (~97.04% base RTP at Level 3).
- **Important multi-set RTP rule** (`cogs/casino/pachinko.py:387-391`):
  - RTP level adjustment is applied **per set** before summing: `adjusted = [rtplevel.adjust("パチンコ", level, bet, bet * r.mult) for r in results]`.
  - `settle()` is called with `sum(adjusted)` and `rtp_done=True` (so `CasinoService.settle_game` does not re-adjust).
  - Sudden event bonus applies once to the aggregate `(total_bet, sum(adjusted))` capped at `10,000`.
- Statistics logging (`infra/db/pachinko.py:21-46`): records every set (`pachinko_sets`) and every spin (`pachinko_spins`) for `/運営 パチンコ統計` (non-fatal on DB failure).

### Reel & Animation Rules (Cosmetic)
- Outcome is computed and settled **before** animation plays (`keep_session=True`, released in `finally`).
- `REEL_SYMBOLS`: `["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "🔥"]`; `SMALL = ["1️⃣", "2️⃣", "3️⃣"]`; `MEDIUM = ["4️⃣", "5️⃣", "6️⃣"]`.
- `pick_reels(round_mult, tier, rng)`:
  - `mult == 2` → triple of random `SMALL`; `mult == 10` → `("7️⃣",)*3`; `mult >= 30` → `("🔥",)*3`.
  - Loss with reach (`tier != ""`) → `(s, s, other)`; loss without reach → 3 distinct symbols.
- Only winning spins animate (`hit_spins`). Frame budget `FRAME_BUDGET = 60` (~66s at `PACHINKO_STEP_SECONDS = 1.1s`).
- `PSEUDO_COUNTS`: `super: [0, 0, 1, 2]`, `premium: [2, 3, 3, 4]`.
- `REVIVE_CHANCE` (only on hit): `normal: 0.10`, `super: 0.25`, `premium: 0.30`.
- `SHOWN_ROUNDS = 6` individual round frames; chains `> 6` summarize with milestone (`10連 突破！！` / `20連 突破！！！`).
- Multi-set animation shows winning sets in descending `mult` order up to `FRAME_BUDGET`.
- Extra replay button (`PachinkoView`): offers `×5連続` when `sets < 5`, or `×10連続` when `5 <= sets < 10`.

## State Machine

```text
IDLE -> [start_game(bet * sets): lock + escrow] -> RESOLVED_AND_SETTLED
RESOLVED_AND_SETTLED -> [record_pachinko_set] -> ANIMATING (1.1s/frame, <=60 frames)
ANIMATING -> [final embed + PachinkoView(90s)] -> RELEASED (session unlocked)
```

## Edge Cases

- `sets` is clamped to `max(1, min(int(sets), 10))`.
- Zero start entries (`starts == 0`) produces zero spins and `mult = 0`.
- Multiple hits within 1 set are all summed without cap.
- If animation Discord edits fail (`discord.HTTPException`), settlement has already succeeded and session is still released in `finally`.
- Result embed color: `ui.GOLD` if `top_round >= 10`, else `ui.OK` if `net > 0`, else `ui.ERROR`.

## User-Facing Japanese Strings

| Key | Verbatim Text | Source |
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
| `pachinko.story.normal` | `🌊 **波の予告**` (`画面が揺れている…`) / `🐟 **魚群が横切った**` (`なにか起きる…？`) / `🎞️ **ロングリーチ**` (`ゆっくり回っている…`) | `cogs/casino/texts.py:162-166` |
| `pachinko.story.super` | `🎬 **ストーリーリーチ**` (`主人公が立ち上がる…！`) / `🚄 **ダッシュリーチ**` (`絵柄が走り出した…！`) / `⚡ **スーパーリーチ**` (`背景が変わった…！`) | `cogs/casino/texts.py:167-171` |
| `pachinko.story.premium` | `🐉 **龍が現れた**` (`地鳴りがする…！！`) / `🌠 **流星群**` (`夜空が光る…！`) / `🔥 **プレミアムリーチ**` (`画面が燃えている…！！`) | `cogs/casino/texts.py:172-176` |
| `pachinko.whisper` | `ざわ… ざわ…` / `じわ… じわ…` / `…どっちだ…` | `cogs/casino/texts.py:179` |
| `pachinko.revive.0..3` | `それでも!!!` (`…諦めない…！！`) / `と、思っていたのか` (`…画面が震えている…！！`) / `まだ終わっていない…！` (`…リールが動き出す…！`) / `ここからだ…！！` (`…運命が書き換わる…！`) | `cogs/casino/texts.py:181-186` |
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
