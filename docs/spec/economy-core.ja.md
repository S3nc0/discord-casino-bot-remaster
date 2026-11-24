[English](economy-core.md) | **日本語**

# 経済の中核、サーバー別の分離、初期残高 3,000、総資産、履歴、ランキング仕様

担当：`B2-B` | 画面 ID：`home`、`ranking`、`history`、`inbox`、`profile`（`packages/shared/src/ids.ts`）

対象：**サーバー別経済**、**初期残高 3,000**、`AccountCore` の台帳と債務の天引き、残高カード（`/ペリカ 残高`）、履歴のまとめ（`/ペリカ 履歴`）、貸借対照表の純資産・流動資産・総資産（`/ペリカ ランキング`）、自動更新のランキング掲示（`/ペリカ ランキング掲示`）、一時的な通知キュー、サーバーの承認ゲート、サーバーごとの機能トグル。

## 元ファイル
- `catalogs/economy.yaml:2-18`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/types.py:8-37`
  - `domain/history.py:1-98`
  - `domain/approval.py:1-36`
  - `domain/features.py:1-85`
  - `infra/db/base.py:22-108`
  - `infra/db/account.py:1-68`
  - `infra/db/wallet.py:52-109,204-301`
  - `infra/db/assets.py:1-218`
  - `infra/db/guild.py:1-194`
  - `infra/db/notices.py:1-30`
  - `infra/db/repositories.py:278-296`
  - `services/economy.py:22-112`
  - `services/ranking.py:1-46`
  - `cogs/economy/cog.py:72-123,201-255,318-325`
  - `cogs/economy/embeds.py:15-79,170-173`
  - `cogs/economy/boards.py:1-188`
  - `cogs/shared/ranking.py:1-110`
  - `cogs/shared/approval_guard.py:1-112`
  - `cogs/shared/announce.py:1-21`
  - `cogs/shared/texts.py:1-20`
  - `cogs/shared/messages/base.py:88-100`
  - `main.py:56-104`

## ルールと正確な数値

### 1. サーバー別経済と初期残高 3,000
- 経済に関わるすべてのテーブルは、`guild_id` で厳密に分けています（`infra/db/base.py:65-108`）。`ScopedRepo._g()` は、`strict=True` で `guild_id == 0` のとき `RuntimeError` を出します。`validate_guild_id` は `guild_id > 0` を要求します。
- 通貨の単位：**ペリカ**（`ペリカ`）。整数のみです（`cogs/shared/ui.py:18,59-61`）。
- 初期残高（`catalogs/economy.yaml:3`、`domain/types.py:9`）：`INITIAL_BALANCE = 3_000`。
- 遅延でのアカウント作成（`infra/db/account.py:19-28`）：
  - `AccountCore.ensure(guild_id, user_id)` が `INSERT OR IGNORE INTO users (guild_id, user_id, balance, created_at) VALUES (?, ?, 3000, now_ts)` を実行します。
  - 行が新しく挿入されたとき（`cur.rowcount == 1`）だけ、台帳に `(+3000, 3000, "初期支給")` を記録します。
  - 共済の口は、アカウント作成時には付与しません（供給量が固定のため）。
  - 読み取り専用の問い合わせ（`peek_stats`、`peek_balance`、他のメンバーの `/ペリカ 残高` の閲覧、`/ペリカ ミッション`）は、アカウントを作りません（`services/economy.py:80-97`）。自分の `/ペリカ 残高` を見たときは、アカウントを作ります。

### 2. アカウントの基本操作（`AccountCore.apply`）
- `apply(guild_id, user_id, delta, reason, income=0)`（`infra/db/account.py:58-67`）：
  - 下限の切り上げ：`after = max(0, before + delta)`（現金の残高はマイナスになりません）。
  - `after != before` のときだけ台帳の行を書き、`actual_delta = after - before` を記録します。
  - `delta > 0 and income > 0` なら `debt_hook.withhold_income(guild_id, user_id, min(income, delta))` を呼びます（債務中なら、自動で 30%（`repay_rate = 0.30`）を帝愛の債務の返済に天引きします。`docs/spec/teiai.ja.md` を参照）。
  - 最終的な残高の純増減 `raw_balance - before` を返します（つまり、天引きしたあとの値です）。
- 管理者の `set_balance(user_id, amount, reason)`（`infra/db/wallet.py:71-99`）：
  - `amount >= 0`：現金の残高を `amount` にします（`income=0`、天引きなし、債務はそのまま）。
  - `amount < 0`：現金の残高を `0` にして、`users.debt = -amount` で上書きします（差額 0 の台帳の行 `"{reason}（借金を {-amount:,}ペリカ に設定）"` を記録し、`after_debt_change` を呼びます）。

### 3. 貸借対照表：純資産・流動資産・総資産
upstream の c099a04 と ce6f500 で、資産はどこでも貸借対照表（B/S）で数えるようになりました：`/ペリカ ランキング`、残高カード、自動更新の掲示、内訳。リマスター：`NetWorthService`（`apps/server/src/finance/net-worth-service.ts`）、区分と並び順は `packages/domain/src/progression/economy-core.ts`。用語は[用語集](glossary.ja.md#資産貸借対照表)。

- **先に借金の利息。** 何かを評価する前に、そのサーバーの債務者全員のトイチの利息を 1 つのトランザクションで計上します（`TeiaiService.accrueGuildDebtInterest`）。ランキングには、いまの借金が出ます。書き込みです（借金だけで、元帳の行はありません）。
- 15 の項目を 3 つの区分にまとめます（`LIQUID_KEYS`、`FIXED_KEYS`、`LIABILITY_KEYS`、`PART_KEYS`）：
  - **流動資産**：
    - `cash`：手持ちの残高
    - `deposit`：帝愛信託の預金
    - `crypto`：現物を、いま売ったときの手取り（`spotSellQuote(...).proceeds`、手数料を引いた額）＋信用取引の建玉を、最新の価格で `max(0, 担保 + 含み損益)`
    - `bonds`：保有中の債券の元本
    - `options`：未決済のオプション（`StocksService.optionValuesByUser`）：買いは、いま売ったときの手取り（満期を過ぎていれば配当）。裸売りは、証拠金 − 買い戻しの費用（満期を過ぎていれば、払う額を引く）。マイナスもあります
    - `pot`：受け取る前の地下作業の稼ぎ（`work_state.pot`）
    - `escrow`：預けている入札：進行中の競り（プレイヤー市場）と、開いている共済の競りの最高入札（リマスターの追加：リマスターは共済の入札も `kyosai_bid_hold` で預かるので、数えないと入札しただけで純資産が減って見えます）
    - `loans_lent`：`active`／`overdue` の個人間の貸付の、まだ返してもらっていない額（貸した人）
  - **固定資産**：
    - `items`：持ち物と、出品中の品を、ショップの値段で（値段のない限定品は 0）
    - `relics`：持ち物・鉱山で受け取りを待っている分（`work_state.relics`）・出品中の発掘品を、`RELIC_VALUE × MERGE_COUNT^星` で
    - `horses`：持っている（引退していない）馬と、出品中の馬を、`max(0, 30,000 + retireValue(races, wins, places))` で
    - `company`：`会社資金 + companyInvested(level)`（事業所の建設費）。出資があれば `computeStakeValues` で社長と出資者に分けます（出資者は出資額まで、社長はそれを超えた分）
    - `tools`：`upgradeSpent(pick) + upgradeSpent(glove) + dormSpent(dorm)`
  - **負債（`parts` にはマイナスで持つ）**：
    - `debt`：帝愛への借金（上の利息を計上したあと）
    - `loans_owed`：`active`／`overdue` の個人間の貸付の、まだ返していない額（借りた人）
- 小計（`assetGroups`）：`liquid`、`fixed`、`gross = liquid + fixed`、`liabilities = −Σ LIABILITY_KEYS`、`net = gross − liabilities`。**「流動資産 ＋ 固定資産 − 負債 ＝ 純資産 ＝ 項目の合計」は常に一致します**（`balance-sheet.test.ts` と `net-worth-service.test.ts` のプロパティテスト）。
- 表示と並び順（`rankBalanceSheets`）：`net`（純資産。既定）、`liquid`（流動資産。ce6f500 で、短い間だけあった `💎 総資産` のボタンを置き換えました。誰も借金がないと、純資産と同じ順位になっていたため）、`gross`（サーバー内だけ）。順番は `(-値, user_id)`、ユーザー ID は数として比べます。口座のある全員に順位がつき、上位 10 人を出します。11 位以下の人には `…` と本人の行を足します。
- ランキングの各行に、小計 `（流動 12,345・固定 6,789・負債 1,000）` を出します。0 の区分は出しません。
- **金融純資産**：以前のランキングの基準（`現金 − 借金 + 評価額`、`netWorth`）は、🟡 富豪の表示（`WEALTHY_ASSETS = 1,000,000`）にだけ残ります。造語の「ファイナル総資産」は廃止し、いまの**純資産**です。
- **コスト。** 集計は資産の種類ごとに 1 本のクエリで、サーバーの人数によらず 1 回あたり約 15 文です。1,000 人を入れた計測で、開発機の中央値 5.7 ms（`net-worth-service.test.ts`）。キャッシュは置きません。

**出る場所（リマスター、決定 D2）。** `/pelica ranking` の既定は週間のゲームのランキングのままで、`表示`（`view: weekly | net | liquid`）を追加しました。`net` か `liquid` では、貸借対照表のランキングと 3 つのボタン `🏆 純資産`・`💧 流動資産`・`🧾 自分の内訳` を出します。ボタンを押せるのはコマンドを実行した人だけです（ほかの人には `core.rank_owner_only` を、本人だけに見える形で返します）。`net` か `liquid` で `内訳` に人を選ぶと、その人の資産の内訳を、実行した人だけに見える形で出します。残高カードには、純資産の順位と `🧾 資産（貸借対照表）` の欄を足しました。Activity のランキング画面は、同じ表彰台の絵の下に、週間（既定）・純資産・流動資産の 3 つのタブと「自分の内訳」のシートがあります（`GET /api/life/net-worth`、クエリ `view=net|liquid`）。

### 4. 自動更新のランキング掲示（`/ペリカ ランキング掲示`）
- 権限：サーバーの `Manage Guild` 権限、または Bot のオーナー（`owner_ids`）（`cogs/economy/cog.py:72-83`）。
- 1 サーバーにつき 1 つの掲示（`leaderboards(guild_id, channel_id, message_id)`）。
- 更新の間隔：`BOARD_INTERVAL_MINUTES = 1` 分（`catalogs/economy.yaml:18`、`cogs/economy/cog.py:226-233`）。
- 貸借対照表の純資産（§3。先に借金の利息を計上）で並べ、上位 10 人を、各行に小計をつけて出します。投稿にボタンはありません。リマスター：`apps/server/src/bot/boards.ts` の `boardStandings`／`boardEmbed`（以前は `現金 − 借金 + 預金 + 現物の取得額 + 債券 + 会社資金` で並べていました）。
- 復旧の動作（`cogs/economy/boards.py:85-106`）：
  - メッセージが削除されていたら（`discord.NotFound`）、投稿し直して `message_id` を更新します。
  - チャンネルが削除されていたら（`channel is None`）、`leaderboards` の DB の行を削除します。
  - `on_guild_remove` で、`leaderboards` の行を削除します（`cogs/economy/cog.py:238-240`）。
- サーバー全体の告知の主な `announce_channel` も兼ねます（ランキング掲示がないか、投稿できない場合は `guild.system_channel` に切り替えます）（`cogs/shared/announce.py:10-20`）。

### 5. 履歴のまとめ（`/ペリカ 履歴`）
- 台帳の直近 `60` 行を取得し（`cogs/economy/cog.py:321`）、最大 `12` 件にまとめます（`domain/history.py:27-93`）：
  - **ゲームのまとめ**：`reason` が `"賭け:"` で始まる行（`game = reason.split(":", 1)[1]`）から始め、続く行のうち `reason` が `":" + game` で終わり、かつ `("追加の賭け:", "払い戻し:", "保険券で半額返金:", "追加の支払い:", "返金:")` のどれかで始まるものを連続して取り込みます。`bet`（最初の行と `"追加の賭け:"` の `-delta`）と `net`（すべての差額の合計）を足し上げ、最後の行の `ts` と `balance_after` を使います。
  - **送金のまとめ**：`^送金（(送|受)）[→←](\d+)$` に一致する行です。`"送"` で、すぐ次の行の `reason == "送金手数料"` なら、手数料を `delta` に合算し、その行の `balance_after` を使います。
  - **その他**：`kind="other"` としてそのまま出します。

### 6. 一時的な通知キュー（`NoticeRepo`）
- `(guild_id, user_id)` ごとに `EcoDb.notices` のメモリ上に保存します（`infra/db/notices.py:19-30`、`infra/db/base.py:39`）。
- 新しい `MAX_NOTICES = 5` 件までに制限します（`catalogs/economy.yaml:8`）。古い未読の通知は捨てます。
- `take_notices(user_id)` はキューを取り出して空にします（旧版では、Bot を再起動すると失われます）。
- 23 種類の通知コードを `cogs/shared/messages/notices.py:9-75` で整形します。

### 7. サーバーの承認ゲートと機能トグル
- **グローバルなコマンドツリーのチェック**（`main.py:59-76`）：
  1. `(utcnow - created_at) > 1.5s` なら、遅いインタラクションの警告ログを出します。
  2. DM の `/運営` コマンドは、`owner_ids` にだけ許可します（`approval_guard.is_owner_dm_command`）。
  3. それ以外の DM のコマンドは、すべて拒否します（`このコマンドはサーバー内でのみ使えます。`）。
  4. `approval_guard.guard` を実行します：
     - `user_id in owner_ids` または `guild_id in allowed_guild_ids` なら、常に許可します。
     - `require_approval` が `true` のとき：`guild_status.status == "approved"` の場合だけ許可します。そうでなければ、`owner_ids` に DM で承認を依頼します（再通知は `RENOTIFY_AFTER = 3600s` に 1 回まで）。
     - `require_approval` が `false` のとき：`allowed_guild_ids` が空の場合だけ許可します。
  5. `approval_guard.command_feature_guard` を実行します：コマンドが、`features_off(guild_id)` で無効にされた機能に対応していないかを確認します。
- **サーバーごとの 18 個の機能トグルのキー**（`domain/features.py:10-29`）：
  `chinchiro`、`pachinko`、`slot`、`blackjack`、`roulette`、`arena`、`horse`、`market`、`bonds`、`kyosai`、`loan`、`company`、`labor`、`quiz`、`raffle`、`poll`、`p2p`、`shop`。
- 最長一致でのコマンドの対応づけ（`domain/features.py:41-80`）：たとえば `"証券 注文 債券"` は `"bonds"` に、`"証券 注文 ..."` は `"market"` に対応します。
- **機能が OFF でも常に許可されるもの**（`domain/features.py:58-68`）：
  `"共済 状況"`、`"共済 取消"`、`"貸付 返済"`、`"貸付 一覧"`、`"会社 状況"`、`"会社 持分"`、`"クイズ 取り下げ"`。
- 機能を止めても、止まるのは新しい活動の開始だけです。進行中のエスクロー、レース、大会、建玉は、通常どおり精算されます。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `core.group_name` | `ペリカ`（`💴 残高・デイリー・ランキング・送金`） | `cogs/economy/cog.py:110` |
| `core.ledger_init` | `初期支給` | `infra/db/account.py:26` |
| `core.ledger_set_debt` | `{reason}（借金を {debt:,}ペリカ に設定）` | `infra/db/wallet.py:91` |
| `core.bal_no_account_title` | `💴 {name} の残高` | `cogs/economy/embeds.py:16` |
| `core.bal_no_account_body` | `まだ遊んでいません（口座がありません）。` | `cogs/economy/embeds.py:16` |
| `core.bal_title` | `{icon} {name} の残高` | `cogs/economy/embeds.py:26` |
| `core.bal_field_status` | `身分` | `cogs/economy/embeds.py:31` |
| `core.bal_field_debt` | `帝愛への借金` / `{debt}（収入の{rate}%が天引きで返済されます。\`/ペリカ 返済\` で自分から返せます）\n⏳ 帝愛の利息（トイチ）: 1日ごとに借金の{daily_rate:.0%}が加わります（{ceiling:,}ペリカまで）` | `cogs/economy/embeds.py:34-36` |
| `core.bal_field_rank` | `このサーバーでの順位（純資産）` / `{rank}位 / {total}人` | `cogs/economy/embeds.py:40` |
| `core.bal_field_collection` | `🏆 コレクション（資産価値 {total}）` | `cogs/economy/embeds.py:44,50` |
| `core.bal_frozen_collection` | `🔒 帝愛により差し押さえ中（借金を完済して、カタギに戻ると返されます）` | `cogs/economy/embeds.py:45` |
| `core.bal_frozen_equip` | `🔒 称号・カード・演出` / `差し押さえ中です（借金を完済して、カタギに戻ると使えます）` | `cogs/economy/embeds.py:56-57` |
| `core.bal_field_crypto` | `証券（現物）の評価額` | `cogs/economy/embeds.py:61` |
| `core.bal_field_bonds` | `債券（預けている元本）` | `cogs/economy/embeds.py:63` |
| `core.bal_field_games` | `遊んだ回数` / `{n:,}回` | `cogs/economy/embeds.py:64` |
| `core.bal_field_bigwin` | `最大の勝ち` | `cogs/economy/embeds.py:65` |
| `core.bal_field_streak` | `連続ログイン` / `{n}日` または `まだ受け取っていません` | `cogs/economy/embeds.py:67-68` |
| `core.bal_field_winrate` | `勝率` / `{pct}%（{plays:,}戦）` | `cogs/economy/embeds.py:73` |
| `core.bal_field_net` | `ゲームの損益` / `{net:+,}ペリカ` | `cogs/economy/embeds.py:74` |
| `core.bal_field_best_streak` | `最大連勝` / `{n}連勝` | `cogs/economy/embeds.py:76` |
| `core.bal_footer` | `勝率・損益は、集計を始めてからのゲームの分です` | `cogs/economy/embeds.py:77` |
| `core.rank_title_net` | `🏆 このサーバーのランキング（純資産）` | `cogs/economy/boards.py:38` |
| `core.rank_footer_net` | `純資産 = 総資産 − 負債（帝愛への借金・個人からの借入） ｜ ペリカはサーバーごとに別々です` | `cogs/economy/boards.py:40` （c099a04） |
| `core.rank_title_liquid` | `🏆 このサーバーのランキング（流動資産）` | `cogs/economy/boards.py` （ce6f500） |
| `core.rank_footer_liquid` | `流動資産 = 現金・預金・株式・債券など、すぐペリカにできる資産（馬・持ち物などの固定資産は含まない） ｜ 内訳は「自分の内訳」で` | `cogs/economy/boards.py` （ce6f500） |
| `core.rank_empty` | `まだ誰も遊んでいません。\`/ペリカ デイリー\` から始めましょう。` | `cogs/shared/ranking.py:30,66` |
| `core.rank_owner_only` | `これは他の人のランキングです。\`/ペリカ ランキング\` で自分を開けます。` | `cogs/economy/boards.py:21` |
| `core.rank_btn_net` | `🏆 純資産` | `cogs/economy/boards.py:53` |
| `core.rank_btn_liquid` | `💧 流動資産` | `cogs/economy/boards.py` （ce6f500） |
| `core.rank_btn_mine` | `🧾 自分の内訳` | `cogs/economy/boards.py:61` |
| `core.breakdown_title` | `🧾 {name} の資産の内訳` | `cogs/shared/ranking.py:90,105` |
| `core.breakdown_no_account` | `まだ口座がありません。` | `cogs/shared/ranking.py:90` |
| `core.breakdown_sections` | `**💧 流動資産**`、`**🏛️ 固定資産**`、`**総資産（流動＋固定）: {gross}**`、`**📉 負債**`、`**負債合計: {liab}**`、`**🧾 純資産（総資産 − 負債）: {net}**`、`（なし）` | `cogs/shared/ranking.py:97-104` |
| `core.breakdown_footer` | `着せ替え・コレクションは買値、馬は購入価格＋引退金の見込み、発掘品は目安の価値、地下作業の工具・寮はこれまでの強化費用で数えます` （リマスター：`持ち物は買値、…`） | `cogs/shared/ranking.py:107` |
| `core.rank_subtotals` | `（流動 {liquid}・固定 {fixed}・負債 {liab}）` （0 の区分は出さない） | `cogs/shared/ranking.py` （c099a04） |
| `core.part_labels` | `💴 現金` `🏦 預金（帝愛信託）` `📈 株式（現物の時価＋信用取引の評価額）` `📜 債券（元本）` `🎯 オプション（評価額）` `⛏ 未収金（受け取る前の地下作業の稼ぎ）` `🔒 預け金（競りへの入札）` `🤝 貸付金（個人への貸付）` `🎁 持ち物（買値）` `🏺 発掘品（目安の価値）` `🐎 競走馬（購入価格＋引退金の見込み）` `🏢 会社（会社資金＋事業所の建設費）` `🧰 地下作業の工具・寮（これまでの強化費用）` `💳 借入金（帝愛への借金）` `📉 借入金（個人からの借入）` | `cogs/shared/texts.py` （c099a04） |
| `core.bal_field_bs` | `🧾 資産（貸借対照表）` / `流動資産 {liquid}　固定資産 {fixed}\n総資産 {gross} − 負債 {liab} ＝ **純資産 {net}**` | `cogs/economy/embeds.py` （c099a04） |
| `core.board_title` | `🏆 ペリカランキング（純資産）` | `cogs/economy/boards.py:72` |
| `core.board_header` | `最終更新: <t:{ts}:R>\n\n` | `cogs/economy/boards.py:73` |
| `core.board_footer` | `{interval}分ごとに自動で更新されます` | `cogs/economy/boards.py:74` |
| `core.board_need_channel` | `チャンネルを指定してください` / `掲示するチャンネルを指定します。止めるときは「止める」を True にしてください。` | `cogs/economy/boards.py:134-135` |
| `core.board_no_perm` | `掲示できません` / `Bot が {channel_mention} に埋め込みを投稿できません。チャンネルの権限を確認してください。` | `cogs/economy/boards.py:147-148` |
| `core.board_set_ok` | `ランキングを掲示しました` / `{jump_url}\n{interval}分ごとに、この投稿を自動で書き換えます。止めるときは \`/ペリカ ランキング掲示\` の「止める」を True にしてください。` | `cogs/economy/boards.py:163-164` |
| `core.board_not_set` | `掲示していません` / `このサーバーには、ランキングの掲示がありません。` | `cogs/economy/boards.py:177` |
| `core.board_unset_ok` | `掲示を止めました` / `自動の更新をやめて、ランキングの投稿を削除しました。` | `cogs/economy/boards.py:185` |
| `core.history_title` | `🧾 最近の増減` | `cogs/economy/embeds.py:172` |
| `core.history_empty` | `まだ記録がありません。` | `cogs/economy/embeds.py:172` |
| `core.history_line` | `<t:{ts}:t> {text}　**{delta:+,}**　→ {balance_after:,}ペリカ` | `cogs/shared/messages/base.py:99` |
| `core.guard_guild_only` | `利用できません` / `このコマンドはサーバー内でのみ使えます。` | `main.py:71` |
| `core.guard_not_allowed` | `このサーバーでは使えません` / `この Bot は、許可されたサーバーだけで遊べます。` | `cogs/shared/approval_guard.py:40` |
| `core.guard_pending` | `承認待ちです` / `このサーバーは、まだ Bot の持ち主に承認されていません。承認を依頼しました。承認されるまで、少しお待ちください。` | `cogs/shared/approval_guard.py:51-52` |
| `core.guard_denied` | `承認待ちです` / `このサーバーでの利用は、Bot の持ち主に許可されていません。` | `cogs/shared/approval_guard.py:49,52` |
| `core.guard_feature_off` | `⏸️ 停止中` / `**{label}** は、いま管理者が止めています。再開まで、お待ちください。\n（止める前に始めたものは、いつもどおり精算されます）` | `cogs/shared/approval_guard.py:88-90` |
| `core.err_missing_perms` | `このコマンドを使うには、サーバーの「サーバー管理」権限が必要です。` | `main.py:81` |
| `core.err_check_failure` | `このコマンドは、いまは使えません。` | `main.py:83` |
| `core.err_forbidden` | `Bot の権限が足りないため実行できませんでした。チャンネルの権限を確認してください。` | `main.py:85` |
| `core.err_http` | `Discord 側のエラーで失敗しました。時間をおいてもう一度お試しください。` | `main.py:87` |
| `core.err_unexpected` | `予期しないエラーが発生しました。[精算の前なら賭けたペリカは返しています（\`/ペリカ 履歴\` で確認できます）。]` | `main.py:92-94` |
