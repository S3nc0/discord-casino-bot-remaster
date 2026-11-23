[English](daily.md) | **日本語**

# デイリーボーナスとストリーク仕様

担当：`B2-B` | 画面 ID：`daily`（`packages/shared/src/ids.ts`） | 機能トグル：なし（常に有効）

## 元ファイル
- `catalogs/economy.yaml:2-11`
- `catalogs/skins.yaml`（季節ごとのデイリーの称号と一言の上書き。`docs/spec/shop.ja.md` を参照）
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/types.py:8-13,38-49`
  - `infra/db/wallet.py:28-31,113-199`
  - `services/economy.py:48-51,123-130`
  - `cogs/economy/cog.py:43-70,124-142`
  - `cogs/economy/embeds.py:81-112`
  - `cogs/shared/messages/base.py:81-86`

## ルールと正確な数値

### JST の 6 時間ごとのリセット枠
- 定数（`catalogs/economy.yaml:4-7`）：
  - `DAILY_BASE = 1_000`
  - `DAILY_STREAK_BONUS = 100`
  - `DAILY_STREAK_CAP = 20`（`(streak - 1)` を `20` で頭打ちにします。倍率をかける前の基本額は最大 `1,000 + 100 * 20 = 3,000`）
  - `DAILY_SLOT_HOURS = 6`（1 日 4 つの受け取り枠：設定のタイムゾーン（既定は JST の `UTC+9`）の `00:00`、`06:00`、`12:00`、`18:00`）
- 枠の番号の式（`cogs/economy/cog.py:55-57`）：
  `slot = now.date().toordinal() * (24 // 6) + (now.hour // 6)` ＝ `toordinal * 4 + hour // 6`。
  （リポジトリ層で `slot` を省略したときは、`today.toordinal()` が既定になります。つまり 1 日に 1 回です。）
- 次の枠の時刻（`cogs/economy/cog.py:60-64`）：
  `midnight(now.date()) + timedelta(hours=(now.hour // 6 + 1) * 6)`。
- 受け取れるかの判定（`infra/db/wallet.py:126-133`）：
  - `last_slot is None and last is not None` なら、旧データの移行のための代替として `last_slot = last.toordinal()` にします。
  - `(last is not None and last > today)`（時計の巻き戻しの対策）、または `(last_slot is not None and slot <= last_slot)` なら拒否します（`ok=False`）。

### ストリークの計算とストリーク保護
- ストリークは 6 時間の枠ではなく、**暦の日**で数えます（`infra/db/wallet.py:134-149`）：
  - `last == today`：`streak = max(1, daily_streak)`（同じ日に何回受け取っても、ストリークの日数は同じです）。
  - `last == today - 1 day`：`streak = daily_streak + 1`。
  - それ以外（`last is None`、または 2 日以上空いた場合）：
    - 既定は `streak = 1`、`guarded = 0`。
    - `last is not None` なら `missed = (today - last).days - 1`、そうでなければ `0`。
    - `missed > 0 and daily_streak > 0` のとき、`inventory` のアイテム `streak_guard` を `missed` 枚だけアトミックに減らそうとします（`WHERE qty >= missed`）。
      - `missed` 枚以上持っていれば：`missed` 枚を消費し、`streak = daily_streak + 1`、`guarded = missed` にします。
      - `missed` 枚未満なら：**0** 枚しか消費せず、`streak = 1` にリセットします。

### 支払額の計算の順番（厳密）
1. 基本額 + ストリーク（`infra/db/wallet.py:150`）：
   `amount = 1000 + 100 * min(streak - 1, 20)`
   （1 日目：`1,000`、2 日目：`1,100`、…、21 日目以降：`3,000`）。
2. 消耗品 `daily_double` のブースト（`infra/db/wallet.py:151-160`）：
   - `profile.daily_boost > 0` を確認します。
   - そうなら：`amount *= 2`、`profile.daily_boost` を `1` 減らし、`boosted = True` にします。
3. 発掘品のバフ（`relic_crown` の `daily` バフキー）（`infra/db/wallet.py:161-163`）：
   - `amount = round(amount * (1 + relic_buffs.get("daily", 0.0)))`（Python の `round()`、銀行丸め。`daily_double` の**あと**に適用）。
4. 帝愛の債務のピンハネ（`infra/db/wallet.py:164-175`）：
   - `debt_before = account.debt(gid, user_id)` を呼びます（先に、1 日分の債務の利息が加算されます）。
   - `debt_before > 0` なら `skimmed = teiai.skim(amount)`（`docs/spec/teiai.ja.md` を参照。債務中のデイリーから 20%（`skim_rate = 0.20`）をピンハネします。債務の元本は減りません）。
   - `skimmed > 0` なら、差額 0 の台帳の行 `"帝愛のピンハネ（デイリー {skimmed:,}ペリカ）"` を記録し、帝愛の胴元口座に `skimmed` を入金します（`house_income_for`）。
5. 純額の入金と、帝愛の債務の返済の天引き（`infra/db/wallet.py:175-183`）：
   - `credit = amount - skimmed`。
   - `account.apply(gid, user_id, credit, reason, income=credit)` を呼びます。
   - 台帳の理由：`f"デイリー（{streak}日連続{'・2倍券' if boosted else ''}{'・連続守り券' + str(guarded) + '枚' if guarded else ''}）"`。
   - `income=credit` なので、債務中なら `withhold_income` が自動で `credit` の 30%（`repay_rate = 0.30`）を、帝愛の債務の返済に天引きします（`repaid = debt_before - account.debt(gid, user_id)`）。
6. 種銭の補充（`infra/db/wallet.py:184`）：
   - `seed = debt.topup_seed_for(gid, user_id)`：債務中で、現金が種銭の基準を下回っていれば、帝愛が上限まで自動で種銭を貸します（債務に加算）。
7. 保存（`infra/db/wallet.py:185-188`）：
   - `users.daily_streak = streak`、`last_daily = today.isoformat()`、`last_slot = slot` を更新します。

### サービス層での副作用（`services/economy.py:123-130`）
- 受け取りに成功したとき（`result.ok == True`）：
  1. `notices.take_notices(user_id)` で、保留中の通知を取り出します（注意：`EconomyService.claim_daily` は、これらを埋め込みに返さずに取り出します。債務の利息や種銭で生じた通知は、すでに `DailyResult` の中で直接まとめられています）。
  2. `earnings.earnings_memo(user_id, now.timestamp())` で、黒服の決算インサイダーメモを抽選します（`docs/spec/stocks.ja.md` を参照）。手に入ったら、別の**エフェメラル**の追加メッセージ（`🕴️ 黒服の噂話`）として送ります。

## 状態機械
- `(guild_id, user_id)` ごとに：
  - `CLAIMABLE`（`slot > last_slot` かつ `today >= last_daily`）--（`/ペリカ デイリー`）--> `CLAIMED_IN_SLOT`（公開の埋め込みと、任意でエフェメラルのインサイダーメモ）。
  - `CLAIMED_IN_SLOT`（`slot <= last_slot`）--（`/ペリカ デイリー`）--> `CLAIMED_IN_SLOT`（次の枠の時刻を示す、エフェメラルの待ち時間の埋め込み）。
  - `CLAIMED_IN_SLOT` --（時計が `00:00`／`06:00`／`12:00`／`18:00` をまたぐ）--> `CLAIMABLE`。

## エッジケース
- 同じ日の複数の 6 時間の枠（例：06:00 と 12:00）での受け取りは、どれもストリークの全額が支払われ（積んだ `daily_boost` も、それぞれ 1 回ずつ消費できます）、`streak` は次の暦の日付になるまで変わりません。
- 埋め込みに表示する `next_bonus`（`embeds.py:93`）は、`min(result.streak, DAILY_STREAK_CAP)` を使います（つまり、ストリークが 1 増えるとして計算した明日の基本額で、`daily_double` と発掘品のバフは含みません）。
- 季節スキンが有効なとき（`skins.active_season(now)`）：埋め込みのタイトルを（`✅` の接頭辞なしで）置き換え、先頭に `season.daily_line` を足します。支払額は変わりません（`cogs/economy/embeds.py:104-111`）。
- 初めての `/ペリカ デイリー` は、最初に `account.ensure` を呼びます。初期残高 `3,000` ペリカを付与してから、1 日目（`+1,000`）を受け取るので、残高は `4,000` になります。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `daily.cmd_name` | `デイリー` | `cogs/economy/cog.py:124` |
| `daily.cmd_desc` | `6時間ごとにもらえる無料ボーナス` | `cogs/economy/cog.py:124` |
| `daily.wait_title` | `まだ受け取れません` | `cogs/economy/embeds.py:83` |
| `daily.wait_body` | `次は **{next_label}**（<t:{next_ts}:R>）から受け取れます。\nボーナスは6時間ごと（0・6・12・18時）です。\n連続ログイン: **{streak}日**` | `cogs/economy/embeds.py:84-85` |
| `daily.ok_title` | `デイリーボーナス`（季節の `daily_title` でなければ、`✅ ` の接頭辞を付けて表示） | `cogs/economy/embeds.py:111` |
| `daily.boost_line` | `🎟️ デイリー2倍券を使った！\n` | `cogs/economy/embeds.py:94` |
| `daily.guard_line` | `🛡️ 連続守り券を **{guarded}枚** 使って、連続ログインをつないだ！\n` | `cogs/economy/embeds.py:96` |
| `daily.skim_line` | `🕴️ 帝愛にピンハネされた: **{skimmed}**（借金は減りません）\n` | `cogs/economy/embeds.py:99` |
| `daily.repaid_line` | `💸 借金の返済に天引きされた: **{repaid}**\n` | `cogs/economy/embeds.py:101` |
| `daily.seed_line` | `🕴️ 帝愛が種銭を貸し付けた: **{seed}**（借金に加わります）\n` | `cogs/economy/embeds.py:103` |
| `daily.ok_body` | `{lead}{boost}**+{amount}**\n{debt_line}連続ログイン: **{streak}日**（明日は {next_bonus}）\n残高: **{balance}**\n\n🕛 次のボーナスは **{next_label}**（<t:{next_ts}:R>）から。6時間ごと（0・6・12・18時）に受け取れます。` | `cogs/economy/embeds.py:105-108` |
| `daily.next_slot_label` | `{hour}:00（{tz_label}）` | `cogs/economy/cog.py:69` |
| `daily.memo_title` | `🕴️ 黒服の噂話` | `cogs/economy/cog.py:140` |
| `daily.memo_body` | `【極秘メモ】<t:{release_at}:F> の {symbol_name} の決算、**{word}**あり…？\n（確度 {truth:.0%} ／ ガセの確率 {1-truth:.0%}。信じるかは、あなた次第。周りには黙っておくか、煽るか…）`（`word` は `大幅な上方修正の噂` または `大幅な下方修正の噂`） | `cogs/shared/messages/base.py:82-86` |
| `daily.ledger_skim` | `帝愛のピンハネ（デイリー {skimmed:,}ペリカ）` | `infra/db/wallet.py:172` |
| `daily.ledger_claim` | `デイリー（{streak}日連続[・2倍券][・連続守り券{guarded}枚]）` | `infra/db/wallet.py:180` |
