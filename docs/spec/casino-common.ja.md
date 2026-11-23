[English](casino-common.md) | **日本語**

# カジノ共通の仕組み（RTP、ジャックポット、イベント、エスクロー、セッション、スキン）

5 つのカジノゲーム（`chinchiro`、`pachinko`、`slots`、`blackjack`、`roulette`）すべてで使う共通の基盤です。
共通契約との整合：`GameId`（`packages/shared/src/ids.ts:48-58`）、`LEDGER_REASONS`（`game_stake`、`game_payout`、`game_refund`、`jackpot_payout`、`debt_withholding`。`packages/shared/src/ledger.ts:19-22,78`）。

## 元ファイル

- `catalogs/games.yaml:1-12,151-161`
- `catalogs/events.yaml:1-13`
- `catalogs/skins.yaml:1-126`
- `legacy/python/domain/games/rtplevel.py:1-181`
- `legacy/python/domain/games/jackpot.py:1-35`
- `legacy/python/domain/events.py:1-66`
- `legacy/python/domain/skins.py:1-123`
- `legacy/python/services/casino.py:1-220`
- `legacy/python/services/session.py:1-35`
- `legacy/python/services/event.py:1-40`
- `legacy/python/infra/db/escrow.py:1-206`
- `legacy/python/infra/db/rtp.py:1-55`
- `legacy/python/cogs/casino/common.py:1-308`
- `legacy/python/cogs/casino/texts.py:78-117`
- `legacy/python/cogs/event/cog.py:1-163`
- `legacy/python/cogs/event/texts.py:1-15`

## ルールと正確な数値

### 賭けの上限とセッションのガード
- `MIN_BET`：`10` ペリカ（`catalogs/games.yaml:3`）。賭け金の上限はなく（残高が上限）、オートコンプリートは 25%／50%／75%／100% を出します。
- セッションの排他（`services/session.py:9-35`）：1 人のユーザーが同時に持てるアクティブなセッションは、カジノゲーム、ショップの購入、送金、確認操作をまとめて 1 つまでです。
- セッション後のクールダウン：`1.5` 秒（`cooldown = 1.5`）。`end()` のあとに単調時計で測ります。
- `len(_last_end) > 1000` になったら、古い `_last_end` のエントリを捨てます。

### エスクローと精算の流れ
1. **開始（`begin_game`）**（`services/casino.py:86-116`、`infra/db/escrow.py:31-49`）：
   - 機能フラグ（`features.CASINO_GAMES[game]`）を確認します。
   - セッションのロックを取ります（`sessions.try_start(user_id)`）。
   - `bet >= 10` と `balance >= bet * balance_factor`（既定 `balance_factor = 1`）を検証します。
   - ウォレットから `bet` を引き（台帳：`賭け:{game}` → `game_stake`）、`escrow` の行を挿入し、`users.total_wagered += bet` にします。
   - 有効なスキンを決めます（`skins.skin_for(profile, game, now)`）。
2. **追加の賭け（`add_to_escrow`）**（`infra/db/escrow.py:51-76`）：
   - ブラックジャックのダブルダウンで使います。`short = extra - raw_balance > 0` かつ `credit = True` なら、帝愛の信用で `short` を借ります（`can_borrow_for_bet_for`、信用による債務の合計は最大 `3,000` ペリカ）。
   - `extra` を引き（`追加の賭け:{game}`）、`escrow.amount` と `users.total_wagered` を増やします。
3. **精算（`settle_game` → `settle_with_penalty`）**（`services/casino.py:118-182`、`infra/db/escrow.py:93-151`）：
   - **ステップ A（RTP の調整）**：サーバーの RTP レベルが `!= 3` で `not rtp_done`（パチンコは事前にセットごとに調整）なら、`escrow_amount` に対して `payout` を調整します。
   - **ステップ B（イベントボーナス）**：`boost = events.best_boost(game, scheduled, manual)` を計算します。`boost > 0` で `payout > bet` なら `event_bonus = min(int((payout - bet) * boost), 10_000)`、そうでなければ `0`。`payout += event_bonus` にします。
   - **ステップ C（保険券）**：`payout == 0` かつ `profile.insurance > 0` なら、`insurance` を 1 減らし、`insured = min(amount // 2, 1000)`（`INSURANCE_CAP = 1000`）を返します。保険はチンチロの追加の支払いには効きません。
   - **ステップ D（入金と債務の天引き）**：`total = payout + insured`。`total > 0` なら、`income = max(0, payout - amount)` で入金します（賭け金を超えた純利益だけが 30% の債務の天引きの対象です。戻った賭け金と保険の返金は天引きされません）。
   - **ステップ E（ハウスの損失分と、ジャックポットへの積み立て）**：
     - `escrow` の行を削除します（二重精算の防止。重複して呼ぶと `None` が返ります）。
     - `lost = max(0, amount - total)`。
     - 帝愛銀行の収入：`int(lost * 0.03)`（`teiai.LOSS_SHARE = 0.03`）。
     - 共有ジャックポットへの積み立て：`int(lost * 0.05)`（`jackpot.SHARE = 0.05`）を、サーバーごとの `jackpot.pool` に足します。
   - **ステップ F（追加の支払い）**：`penalty > 0`（チンチロの倍払い）なら、手元の現金から引けるだけ引きます。不足分は `debt.owe_for(gid, user_id, penalty - taken, f"{game}の倍払い")` を呼びます（資産の強制差し押さえ → 帝愛の債務）。
   - **ステップ G（統計と記録）**：
     - `net = total - amount - max(penalty, 0)`。
     - `users` を更新します：`games_played += 1`、`total_won += total`、`biggest_win = MAX(biggest_win, net)`。
     - `record_play(user_id, game, bet, net, today, tags)` を呼び、ストリーク、デイリーミッション、週間の統計に反映します。
   - **ステップ H（ジャックポットの抽選）**：積み立て後の `jackpot.pool` に対して抽選します。当たれば `pool` の全額を `income = pool` として支払い（30% の債務の天引きの対象）、`pool = 0` に戻します。
4. **中断とクラッシュからの復旧**（`infra/db/escrow.py:175-205`）：
   - `refund(escrow_id)` は `escrow.amount` の全額を返します（`返金:{game}` → `game_refund`）。`games_played` と `total_won` は増やしません。
   - Bot の起動時に `refund_all_escrows()` が、残っているすべての行を返金します（`返金（中断したゲーム）:{game}`）。

### RTP レベル（管理者が設定）
- サーバーごと・ゲームごとのレベルは `{1, 2, 3, 4, 5, 6}` で、既定は `3` です（`rtplevel.py:21-24`）。レベル 3 にすると DB の行を削除します。
- `STEP = 0.04`（1 レベルあたり RTP が 4 ポイント）。
- 式（`rtplevel.py:146-158`）：
  - `factor(game, level, kind) = 1 + (level - 3) * 0.04 / W`
  - `approx_rtp(game, level, kind) = base_rtp + (level - 3) * 0.04`
  - `adjust(game, level, bet, payout, kind)`：`level == 3` または `payout <= bet` ならそのまま。そうでなければ `bet + max(0, int((payout - bet) * factor))`。
- ゲームごとの基本 `(RTP, W)`：
  - `slots`：`6^3 = 216` 通りのリールの組み合わせを全数列挙（`rtplevel.py:32-45`）。
  - `roulette`：賭けの種類 `kind` ごとに厳密に計算：`p = hits/37`、`RTP = p * mult`、`W = p * (mult - 1)`（既定の kind は `"red"`）。
  - `pachinko`：厳密な DP の畳み込み：`RTP = pachinko.rtp()`、`W = rtp() - hit_rate()`。
  - `chinchiro`：固定値 `RTP = 0.985`、`W = 0.653`。
  - `blackjack`：固定値 `RTP = 0.918`、`W = 0.412`。

### サーバー共有のジャックポット
- `SHARE = 0.05`（`lost = max(0, bet - (payout + insured))` の 5%）。
- `PELICA_PER_CERTAIN = 2_000_000`。
- `MAX_CHANCE = 0.02`（1 回の精算での上限は 2%。`bet >= 40_000` で到達）。
- `MIN_POOL = 10_000`（`pool < 10_000` のうちは当たりません）。
- `chance(bet, pool) = 0.0`（`bet <= 0` または `pool < 10_000`）、そうでなければ `min(0.02, bet / 2_000_000)`。
- `draw(rng, bet, pool) = p > 0 and rng.random() < p`。

### 突発イベントと手動の特別イベント
- 毎日の突発イベント（`domain/events.py:14-50`）：
  - 決定論的な PRNG のシード：`random.Random(f"event:{guild_id}:{day.isoformat()}")`。
  - ゲーム：`rng.choice(sorted(["チンチロ", "パチンコ", "スロット", "ブラックジャック", "ルーレット"]))`。
  - 開始の分（JST）：`rng.randrange(720, 1411, 5)`（12:00〜23:30、5 分刻み、両端を含む）。
  - 長さ：`30` 分（`end_min = start_min + 30`。日をまたぎません）。
  - 有効な時間帯：`start_min <= now_min < end_min`。
  - ブースト：`+0.5`（利益 `payout - bet` の +50%）。ゲームごとに `BONUS_CAP = 10_000` で頭打ち。
  - 告知のループ：1 分ごと（`cogs/event/cog.py:59`）。フェーズは `0`（未告知）→ `1`（開始を告知）→ `2`（終了を告知）。Bot が時間帯を逃した場合（`phase == 0` かつ `now_min >= end_min`）は、投稿せずに `phase = 2` にします。
- 手動の特別イベント（`services/event.py:24-39`）：
  - オーナーが `game`、`boost_pct`（1〜300、既定 50）、`minutes`（1〜180、既定 30）、任意で投稿先のチャンネルを設定します。有効な手動イベントがあれば置き換えます。
  - 重ならないルール（`events.best_boost`）：`game` が一致するとき `max(scheduled_boost, manual_boost)` を取ります。上限も同じ `10_000` です。

### スキンと季節スキン
- 装備スロット（`catalogs/skins.yaml:2-5`）：`チンチロ → skin_dice`、`パチンコ / ブラックジャック → skin_table`。
- 優先順位（`domain/skins.py:109-111`）：そのゲームに合う装備中のスキンが優先され、なければ有効な季節スキン（`season.start <= now < season.end`）になります。
- 見た目だけです。オッズ、配当、アニメーションのフレーム数は変わりません。
- 債務があるとき（`underground` / `bankrupt`）は、持っているスキンは差し押さえられ、非表示になります（`get_profile` が空のスロットを返します）。
- 設定済みの季節：`christmas_2026`（`2026-11-21T00:00:00+09:00` から `2026-12-26T00:00:00+09:00`）。5 つのゲームすべてのスキン、`daily_title`、`daily_line`、`house_horse_icon: "🦌"` を提供します。

### 祝福の閾値とリプレイのビュー
- `ratio = net / bet` による大勝ちの段階（`cogs/casino/texts.py:81-85,108-116`）：
  - `>= 50`：ジャックポット級のバナーと ASCII アート `JACKPOT_ART`（`missions.is_jackpot`、`jackpot_multiplier = 50`）。
  - `>= 10`：超特大勝ちのバナー。埋め込みの色を `ui.GOLD` にします。
  - `>= 3`：大勝ちのバナー。
- 連勝の表示：`streak >= 2` から表示し、炎の絵文字は `min(streak // 2 + 1, 4)` 個。`new_best and streak >= 3` のとき自己ベストのバッジを出します。
- リプレイのボタン（`ReplayView`、タイムアウト `90` 秒）：同じ額（`bet`）と倍の額（`bet * 2`）。

## 状態機械

```text
IDLE -> [begin_game: lock + validate + debit escrow] -> IN_PLAY
IN_PLAY -> [settle_game: RTP -> event -> insurance -> payout/penalty -> stats -> jackpot -> unlock] -> SETTLED
IN_PLAY -> [abort_game / startup refund_all_escrows: full refund -> unlock] -> ABORTED
```

## エッジケース

- `settle()` を重複して呼んでも何も起きません（`ctx.done` のガードと、`None` を返す `DELETE FROM escrow`）。
- `payout == 0` で保険券を持っているときは、`lost = amount - insured` です（銀行の `loss_share` とジャックポットの `contribution` は、保険を引いたあとの損失で計算します）。
- `result_lines()` は、払い戻しとして `payout + ctx.rtp_shift + ctx.insured_refund` を表示し、RTP レベルをプレイヤーから隠します。
- 対話型のゲーム（ブラックジャックとチンチロ）は、本番では `random.SystemRandom()` を使います。純粋なドメイン関数は、注入された `random.Random` を受け取ります。
- ReplayView がタイムアウトすると、ボタンが消えます（`edit_original_response(view=None)`）。

## ユーザーに表示する日本語文言

| キー | 原文 | 出典 |
|---|---|---|
| `session.active` | `いま遊んでいるゲームがあります。終わってから次を始めてください。` | `services/session.py:19` |
| `session.cooldown` | `少し待ってください（あと {wait:.1f} 秒）。` | `services/session.py:22` |
| `casino.group.desc` | `🎰 ペリカを賭けて遊ぶ（遊びのゲーム用の仮想通貨です）` | `cogs/casino/cog.py:45` |
| `casino.bet.help` | `賭けるペリカ（{MIN_BET:,}以上。上限なし）` | `cogs/casino/cog.py:25` |
| `casino.err.cannot_start` | `まだ始められません` | `cogs/casino/common.py:144` |
| `casino.err.min_bet_title` | `賭け金が少なすぎます` | `cogs/casino/common.py:148` |
| `casino.err.min_bet_body` | `{MIN_BET:,}ペリカ 以上で指定してください。` | `cogs/casino/common.py:148` |
| `casino.err.no_balance_title` | `ペリカが足りません` | `cogs/casino/common.py:156` |
| `casino.err.no_balance_factor` | `{factor_reason}賭け金の **{balance_factor}倍**（{need:,}ペリカ）以上の残高が必要です（いまの残高: {balance:,}ペリカ）。\nいまの残高なら、**{max_bet:,}ペリカ** まで賭けられます。` | `cogs/casino/common.py:152-155` |
| `casino.err.no_balance_daily` | `賭け金 {bet:,}ペリカ に対して、残高は {balance:,}ペリカ です。\n\`/ペリカ デイリー\` で6時間ごとにもらえます。` | `cogs/casino/common.py:158` |
| `casino.err.no_balance_short` | `賭け金 {bet:,}ペリカ に対して、残高は {balance:,}ペリカ です。` | `cogs/casino/common.py:164` |
| `casino.err.not_owner` | `これは他の人のゲームです。\`/カジノ\` で自分も遊べます。` | `cogs/casino/common.py:247` |
| `casino.err.disabled_guild_title` | `使えません` | `cogs/casino/common.py:263` |
| `casino.err.disabled_guild_body` | `このサーバーでは、いまは遊べません。` | `cogs/casino/common.py:264` |
| `casino.err.runtime_title` | `エラーが発生しました` | `cogs/casino/common.py:301` |
| `casino.err.runtime_body` | `ゲームを中止しました。精算前なら賭け金はお返ししています（\`/ペリカ 履歴\` で確認できます）。` | `cogs/casino/common.py:302` |
| `casino.result.insurance` | `🎟️ 保険券を使った！ 賭け金の半分（{refund:,}ペリカ）が戻った` | `cogs/casino/common.py:193` |
| `casino.result.event_bonus` | `🔥 **突発イベントのボーナス +{bonus:,}ペリカ**` | `cogs/casino/common.py:194` |
| `casino.result.bet` | `賭け金: **{bet:,}ペリカ**` | `cogs/casino/common.py:196` |
| `casino.result.payout` | `払い戻し: **{payout:,}ペリカ**` | `cogs/casino/common.py:197` |
| `casino.result.net` | `損益: **{signed_net}ペリカ**` | `cogs/casino/common.py:198` |
| `casino.result.balance` | `残高: **{balance:,}ペリカ**` | `cogs/casino/common.py:199` |
| `casino.result.debt` | `借金: **{debt:,}ペリカ**（収入の{pct}%が天引きで返済されます）` | `cogs/casino/common.py:203` |
| `casino.result.jackpot_pool` | `💰 共有ジャックポット: いま **{pool:,}ペリカ**` | `cogs/casino/common.py:206` |
| `casino.result.jackpot_won` | `# 💰 共有ジャックポット！！ 💰\n**+{won:,}ペリカ** を総取り！` | `cogs/casino/common.py:222` |
| `casino.result.mission_done` | `📜 ミッション達成！ 「{name}」 **+{reward:,}ペリカ**` | `cogs/casino/common.py:232` |
| `casino.result.mission_all` | `🎁 **今日のミッションを全部達成！** ボーナス **+{bonus:,}ペリカ**` | `cogs/casino/common.py:234` |
| `casino.replay.again` | `🔁 同じ額でもう一度（{bet:,}）` | `cogs/casino/common.py:253` |
| `casino.replay.double` | `⏫ 倍にして（{bet2:,}）` | `cogs/casino/common.py:254` |
| `casino.tier.50x` | `🎰💥 **超特大ジャックポット級！！** 💥🎰` | `cogs/casino/texts.py:82` |
| `casino.tier.10x` | `💎✨ **特大勝ち！！** ✨💎` | `cogs/casino/texts.py:83` |
| `casino.tier.3x` | `🎉 **大勝ち！** 🎉` | `cogs/casino/texts.py:84` |
| `casino.streak.line` | `{fire} **{streak}連勝中！**` | `cogs/casino/texts.py:102` |
| `casino.streak.best` | `　🏅 自己ベスト更新！` | `cogs/casino/texts.py:104` |
| `event.title.chinchiro` | `🎲 チンチロ大会` / `親も子も熱くなる時間。` | `cogs/event/texts.py:4` |
| `event.title.pachinko` | `🎰 パチンコ爆裂タイム` / `玉がよく入る気がする…！` | `cogs/event/texts.py:5` |
| `event.title.slots` | `🍒 スロット確変タイム` / `リールが今日はよく回る。` | `cogs/event/texts.py:6` |
| `event.title.blackjack` | `🃏 ブラックジャック・ナイト` / `21を狙うなら今夜。` | `cogs/event/texts.py:7` |
| `event.title.roulette` | `🎡 ルーレット・フィーバー` / `ボールの行方は誰にも読めない。` | `cogs/event/texts.py:8` |
| `event.start.title` | `🔥 突発イベント発生！ {title}` | `cogs/event/cog.py:79` |
| `event.start.body` | `{blurb}\n\n**{start} 〜 {end}**（{dur}分間）の間、\`/カジノ {game}\` で勝つと、**勝ち分が{mult:g}倍**になります。\n（上乗せは1回につき最大 {cap:,}ペリカ まで）` | `cogs/event/cog.py:74-78` |
| `event.manual.title` | `🔥 特別イベント発生！ {title}` | `cogs/event/cog.py:90` |
| `event.end.title` | `{title} は終了しました` | `cogs/event/cog.py:73` |
| `event.end.body` | `また次のイベントをお楽しみに！` | `cogs/event/cog.py:73` |
| `ledger.bet` | `賭け:{game}` | `infra/db/escrow.py:40` |
| `ledger.bet_add` | `追加の賭け:{game}` | `infra/db/escrow.py:68` |
| `ledger.payout` | `払い戻し:{game}` | `infra/db/escrow.py:127` |
| `ledger.insurance` | `保険券で半額返金:{game}` | `infra/db/escrow.py:127` |
| `ledger.penalty` | `追加の支払い:{game}` | `infra/db/escrow.py:141` |
| `ledger.jackpot` | `ジャックポット` | `infra/db/escrow.py:168` |
| `ledger.refund` | `返金:{game}` | `infra/db/escrow.py:184` |
| `ledger.refund_crash` | `返金（中断したゲーム）:{game}` | `infra/db/escrow.py:203` |
