[English](weekly-ranking.md) | **日本語**

# 週間ランキングと称号の仕様

担当：`B2-B` | 画面 ID：`ranking`（`packages/shared/src/ids.ts`） | 機能トグル：なし

## 元ファイル
- `catalogs/economy.yaml:61-64`
- `catalogs/shop.yaml:42-48`（`title_weekly_king`）
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/weekly.py:1-33`
  - `domain/history.py:95-97`
  - `infra/db/records.py:68-72,117-218`
  - `services/economy.py:149-160`
  - `cogs/weekly/cog.py:1-125`
  - `cogs/weekly/embeds.py:1-31`
  - `cogs/shared/messages/base.py:102-110`

## ルールと正確な数値

### 週の区切りと識別子
- 週は、設定のタイムゾーン（既定は JST、`UTC+9`）の**月曜 00:00 から日曜 23:59:59** までです（`domain/weekly.py:3,15-25`）。
- `week_start(day) = day - timedelta(days=day.weekday())`（ISO の月曜）。
- `week_id(day) = week_start(day).isoformat()`（例：`"2026-10-26"`）。
- `previous_week_id(day) = (week_start(day) - timedelta(days=7)).isoformat()`。
- `week_label(week)`：`"{start.month}/{start.day}〜{end.month}/{end.day}"`。ここで `end = start + timedelta(days=6)`（ゼロ埋めなし。例：`"10/26〜11/1"`）。

### 記録と順位
- 記録されたカジノゲームのプレイ（`RecordRepo.record_play`）のたびに、`weekly_stats(guild_id, week, user_id, net, plays)` に upsert し、`net += game_net`、`plays += 1` にします（`infra/db/records.py:68-72`）。注意：毎日のミッションと違い、`weekly_stats` の記録には `MIN_BET` のフィルターが**ありません**。
- 順位の並び順（`infra/db/records.py:123`）：
  `ORDER BY net DESC, plays ASC, user_id ASC`（純利益の多い順。同点なら、プレイ数の少ない順。それも同じなら `user_id` の小さい順）。
- `weekly_rank(week, user_id)` は、最大 10,000 行を調べ、`(rank_1based, net, plays, total_players)` か `None` を返します（`infra/db/records.py:128-134`）。

### 王者の資格と称号の付与
- 定数（`catalogs/economy.yaml:61-64`）：
  - `MIN_PLAYS = 5`（その週に遊んだゲームの最低数）
  - `ANNOUNCE_TOP = 5`（週間の発表に表示する上位の人数）
  - `CHECK_MINUTES = 5`（バックグラウンドのポーリングの間隔、分）
- 専用の称号のアイテム：`shop.WEEKLY_KING = "title_weekly_king"`（`catalogs/shop.yaml:42-48` での表示名は `今週の王者`。購入不可、`price: 0`）。
- `weekly_award(week)` のアトミック性（`infra/db/records.py:155-192`）：
  1. `guild_id` の `weekly_state.last_week` を確認します。`last is not None and last >= week` なら `None` を返します（二重の発表を防ぐ、冪等性のガード）。
  2. このサーバーで、`inventory` の `title_weekly_king` を持っている現在の保有者を全員探します（`previous`）。
  3. このサーバーの**全ユーザー**から `title_weekly_king` を外します：
     - `DELETE FROM inventory WHERE guild_id=? AND item_id='title_weekly_king'`
     - `UPDATE profile SET title=NULL WHERE guild_id=? AND title='title_weekly_king'`
  4. 王者を選びます：`WHERE guild_id=? AND week=? AND net > 0 AND plays >= 5 ORDER BY net DESC, plays ASC, user_id ASC LIMIT 1`。
  5. 王者がいれば：
     - `weekly_champions(guild_id, week, user_id, net)` に挿入します（`INSERT OR REPLACE`）。
     - `inventory(guild_id, user_id, 'title_weekly_king', qty=1)` を付与します（`qty=1` で upsert）。注意：自動では**装備されません**。王者は `/ショップ` で自分で装備します。
     - 通算の `wins = COUNT(*) FROM weekly_champions WHERE guild_id=? AND user_id=?` を計算します。
  6. `weekly_state.last_week = week` を記録します。
  7. `{"champion": (uid, net, plays) | None, "previous": [u for u in previous if not champion or u != champion[0]], "wins": wins, "standings": weekly_top(week, 5)}` を返します。

### スケジュールと起動時の動作
- バックグラウンドのタスク `check_weeks` は、`5` 分ごとにループします（`cogs/weekly/cog.py:58-63`）。
- `cog_load` のとき、番兵の行 `weekly_state(guild_id=0, last_week='backfilled')` で守られた、1 回だけの `backfill_weekly(utc_offset_hours)` を実行し、`domain.history.game_results()` を使って、`ledger` から過去の `weekly_stats` を復元します（`infra/db/records.py:194-218`）。
- ティックごとに（`cogs/weekly/cog.py:69-87`）、許可されたすべてのサーバーについて：
  - `prev_week = weekly.previous_week_id(clock.today())`。
  - `weekly_last_announced(guild_id)` が `None` なら：告知**せずに** `last_week = prev_week` で初期化します（つまり、初回の実行では、次の月曜まで待ちます）。
  - そうでなく `last < prev_week` なら：`announce(guild, prev_week)` を呼びます。月曜 00:00 を過ぎても Bot がオフラインだった場合は、起動時に 1 回だけ告知します。
- 告知のチャンネル：`announce_channel(guild, guild_repo)`（ランキング掲示のチャンネルが設定され、投稿できるならそこ、そうでなければ `guild.system_channel`）（`cogs/weekly/cog.py:93`）。
- `result["standings"]` が空（その週は誰も遊ばなかった）でも、`weekly_award` は古い称号を外して `last_week = week` を記録し、`announce` は投稿を飛ばします（`cogs/weekly/cog.py:90-92`）。
- `result["previous"]` の全ユーザー（外された前の王者のうち、連続で王者にならなかった人）について、`shop_bridge.sync_title_nick(uid, guild)` を呼び、Discord のニックネームから称号を外します（`cogs/weekly/cog.py:108-112`）。

## 状態機械
- サーバーごとの `weekly_state.last_week`：
  `None` --（最初のポーリング）--> `prev_week`（投稿なし）
  `W_old` --（時計が月曜 00:00 をまたぐ、`W_old < prev_week`）--> `weekly_award(prev_week)` --> `prev_week`（`standings` が空でなければ投稿。外された人のニックネームを同期）。

## エッジケース
- 前の王者が連続で王者になった場合は、`previous` から除かれるので、「前の王者 ... の称号は外れました」の行は出力されず、ニックネームもクリアされません（`infra/db/records.py:189`）。注意：インベントリを付与し直す前に、167 行目で `profile.title` が `NULL` にクリアされるので、連続した王者は、保持されない限り、`/ショップ` で称号を装備し直す必要があります（旧版との一致のために記録しておくべき、正確なクセです）。
- 5 ゲーム以上遊んで `net > 0` の人が誰もいなければ（遊んで負けた場合や、5 ゲーム未満の場合も含む）、`champion` は `None` になり、前の王者の称号は**それでも**取り消され、埋め込みには「王者はお休みです」と出ます。
- メンションの通知が飛ぶのは、勝った王者だけです（`content=f"🎉 <@{champ[0]}>"` と `AllowedMentions(users=[champ])`）。順位のほかのメンションは通知されません（`cogs/weekly/cog.py:96-105`）。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `weekly.embed_title` | `🏆 週間ランキング 発表！（{week_label}）` | `cogs/weekly/embeds.py:28` |
| `weekly.embed_footer` | `毎週月曜0時に発表 ｜ 稼ぎ = その週のゲームの損益の合計` | `cogs/weekly/embeds.py:29` |
| `weekly.ping_content` | `🎉 <@{user_id}>` | `cogs/weekly/cog.py:102` |
| `weekly.standing_line` | `{mark} <@{uid}>　**{net:+,}ペリカ**（{plays}戦）{me}`（`mark` ＝ `🥇`/`🥈`/`🥉`/`\`{r:>2}\``、`me` ＝ `　◀ あなた` または `""`） | `cogs/shared/messages/base.py:107-109` |
| `weekly.champion_line1` | `👑 **<@{user_id}>** が **{title_name}** を獲得しました！（通算{wins}回目）` | `cogs/weekly/embeds.py:18` |
| `weekly.champion_line2` | `今週の稼ぎ **{net:+,}ペリカ**（{plays}戦）。\`/ショップ\` の「持ち物」の画面で身につけられます（次の発表まで）。` | `cogs/weekly/embeds.py:19` |
| `weekly.no_champion` | `今週は、{min_plays}ゲーム以上遊んでプラスだった人がいませんでした。王者はお休みです。` | `cogs/weekly/embeds.py:24` |
| `weekly.previous_revoked` | `前の王者 {mentions_joined_by_nakaguro} の称号は外れました。` | `cogs/weekly/embeds.py:27` |
