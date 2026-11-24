[English](player-market.md) | **日本語**

# プレイヤーマーケット、オークション、エスクロー（P2P）仕様

担当：`B3` | 画面 ID：`market`、`market-create`、`market-mine`（`packages/shared/src/ids.ts`） | 機能トグル：`p2p`

> 入り口：旧版には独立したスラッシュコマンドがありません。`/ショップ` → `🕴️ 帝愛の競売` → `🤝 プレイヤーの出品` / `📤 出品する` / `📋 自分の取引` から使います（`cogs/p2p/cog.py:1-8`）。告知チャンネルの投稿にも、永続の `🔍 見る・買う・入札` ボタンが付きます。

## 元ファイル
- `catalogs/economy.yaml:66-92`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/p2p.py:1-77`
  - `infra/db/p2p.py:1-454`
  - `services/p2p.py:1-100`
  - `cogs/p2p/cog.py:1-318`
  - `cogs/p2p/embeds.py:1-93`
  - `cogs/p2p/views.py:1-263`
  - `cogs/shared/messages/economy.py:85,169-190`
  - `cogs/shared/messages/notices.py:46-62,72-75`

## ルールと正確な数値

### 1. 定数と上限（`catalogs/economy.yaml:66-92`、`domain/p2p.py:15-38`）
- `FEE_RATE = 0.05`（`int(price * 0.05)` を売り手の受け取りから引き、`bank_income_for` で帝愛銀行に入金します）。
- `MAX_ACTIVE = 5`（売り手ごとの、同時に出せる出品の数）。
- `FIXED_DAYS = 7` 日（固定価格の出品の有効期限）。
- `AUCTION_HOURS = [1, 6, 24, 72]`（選べるオークションの期間。単位は時間）。
- オークションの入札：
  - `MIN_INCREMENT_RATE = 0.05`、`MIN_INCREMENT = 100`。
  - `min_next_bid(start, current)`：`current <= 0` なら `start`、そうでなければ `current + max(100, math.ceil(current * 0.05))`。
  - スナイプ対策：`SNIPE_SECONDS = 300`（5 分）。`end_at - now < 300` なら、`end_at = max(end_at, now + 300)` に延ばします。
- `PAIR_DAILY_LIMIT = 100_000` ペリカ：順序なしの 2 者 `{A, B}` のあいだの、直近 24 時間の取引量の上限です。共済の口の P2P 譲渡と**共有**します（直近 86,400 秒の、`market_listings` の sold と `kyosai_offers` の done）。
- `CONFIRM_FROM = 10_000`（`>= 10,000` の購入・入札では、30 秒の `ConfirmView` を出します）。
- `ESCROW_OWNER = -3`（馬を出品してエスクローしている間は、`horses.owner_id` を `-3` にします。厩舎から隠れ、出走登録もできなくなります）。

### 2. 取引できる資産と価格の範囲（`domain/p2p.py:40-60`）
- **取引できるアイテム**：
  - 発掘品（`kind == "relic"`）：`item_id in shop.RELIC_VALUE` なら取引できます（`price == 0` かつ `limited == True` でも）。
  - ショップのアイテム：`price > 0`、`not limited`、かつ `kind ∈ {consumable, racing, card_color, card_icon, skin_dice, skin_table, color_role}` なら取引できます。
  - 称号、コレクション、限定アイテム、帝愛の闇市の限定品は、取引できません。
- **取引できる馬**：売り手が所有していて、`entry`／`betting` のレースに登録されていないこと（`p2p_horse_in_race`）。
- **価格の範囲の制限（RMT と送金の迂回の対策）**：
  - `MIN_PRICE = 100`、`ITEM_PRICE_RANGE = [0.10, 5.0]`、`HORSE_PRICE_RANGE = [3_000, 300_000]`。
  - 馬：`[3_000, 300_000]`。
  - アイテム：`base = RELIC_VALUE.get(item_id, item.price) * max(1, qty)`。
    `high = min(100_000, math.floor(base * 5.0))`、`low = min(max(100, math.ceil(base * 0.10)), high)`。

### 3. エスクロー、購入、入札、精算（`infra/db/p2p.py:106-403`）
- **出品（`p2p_list`）**：
  - 売り手が破産猶予中（`grace_lock`）か、進行中の出品が `>= 5` 件なら、できません。
  - アイテム：`inventory` から `qty` をアトミックに引きます。`profile.{card_color|card_icon|skin_dice|skin_table}` で装備中で、残りの `qty <= 0` なら、自動で外します。
  - 馬：`horses.owner_id = -3` にします。
  - `announce_channel` に、永続の `ListingButton`（`p2p:open:<id>`）つきの公開の埋め込みを投稿します。
- **買い手の確認（`_p2p_buyer_check`）**：
  - 自分の出品は買えません、入札もできません（`p2p_self_buy`）。
  - 買い手は `🟢 カタギ`（`p2p_katagi_only`）で、猶予中（`grace_lock`）でないこと。
  - 現金 `>= amount`。
  - 受け取れること：馬は `horse_count < MAX_HORSES (3)`、`unique` のアイテムはまだ持っていないこと（`already_owned`）。
  - 2 者間の 24 時間の上限：`pair_total + amount <= 100,000`。
- **固定価格の購入（`p2p_buy`）**：
  - アトミックに実行します：買い手から `price` を引き（`取引:購入（{label}）`）、売り手に `price - fee` を支払い（`取引:売却（{label}）`、`income = price - fee`。売り手があとで債務を抱えていたら、30% の債務の天引きがかかります）、`fee` を銀行に入金し、アイテムや馬を買い手に移し、`sold` にします。
- **オークションの入札（`p2p_bid`）**：
  - 自分が最高入札者のときは、さらに入札できません（`p2p_already_highest_bidder`）。
  - 前の `bidder_id` に返金し（`取引:入札の返金（{label}）`）、`p2p_outbid` の通知を送ります。
  - 新しい `amount` を入札者からエスクローし（`取引:入札（{label}）`）、`bid`、`bidder_id`、スナイプ対策の `end_at` を更新します。
- **取り消し（`p2p_cancel`）**：
  - 売り手は、進行中の固定価格の出品か、**入札のない**（`bidder_id == 0`）オークションを取り消せます。入札が入ったら、取り消せません（`p2p_cancel_has_bid`）。
- **強制的な引き戻し（`p2p_pull_back_for`）**：
  - ユーザーが**破産猶予**に入ったとき（`on_grace_enter`）か、**破産**を宣言したとき（`prepare`）に、自動で発動します。
  - ユーザーの進行中の出品をすべて取り消し（最高入札者には `p2p_seller_pulled_back` の通知とともに返金し、アイテムや馬は、破産で差し押さえられるよう売り手に戻します）、さらに、ユーザーが入れている進行中の最高入札も取り下げます（エスクローした現金をユーザーに返金）。
- **オークションと期限の精算（`p2p_settle`）**：
  - 30 秒ごとに動きます（`P2PCog.tick`）。
  - `bidder_id` があるオークション：`_p2p_can_receive` と、24 時間の 2 者間の上限を再確認します。
    - 有効なら：売買を完了し（`_p2p_sell`）、落札者に通知し（`p2p_won`）、`announce_channel` に `🔨 競りの落札` を投稿します。
    - 無効なら（たとえば、オークションの途中で落札者が 3 頭の馬を買った、2 者間の上限に達したなど）：エスクローした入札を落札者に返金し（`p2p_won_failed`）、資産を売り手に戻し（`p2p_buyer_cannot_receive`）、`expired` にします。
  - 売れ残った固定価格とオークションの出品：資産を売り手に戻し、`expired` にして、`p2p_unsold` の通知を送ります。

### 4. 並び順（`infra/db/p2p.py:26-31`）
- `end`（既定）：`end_at ASC, id ASC`
- `price_asc`：`CASE WHEN bid>0 THEN bid ELSE price END ASC, id ASC`
- `price_desc`：`CASE WHEN bid>0 THEN bid ELSE price END DESC, id ASC`
- `new`：`id DESC`

### 5. 帝愛の発掘品の競り（リマスターで追加。上流 736efad）
帝愛が、ギルドごとに **UTC の1日に1回**、**発掘品を1つ**、このマーケットに24時間の競りで出します。
- **設定**（`catalogs/teiai.yaml`：`relic_auction_per_day: 1`、`relic_auction_hours: 24`。コードは `packages/domain/src/shop/teiai-market.ts` の `RELIC_AUCTION_PER_DAY`、`RELIC_AUCTION_HOURS`）。1日の数を `0` にすると出しません。サーバーのオプション `relicAuctionPerDay` で渡し、テスト用のワールド（サーバーのテストキット、e2e、不変条件）は、テストが有効にしない限り `0` です。
- **どの発掘品か**（`pickRelic`）：地下作業で掘れる確率に比例して選びます（★なしのみ）。化石 0.0033、骨 0.0017、隕石 0.00067、壺 0.00027、王冠 0.000067、竜の涙 0.000017 を正規化すると、54.8% / 28.2% / 11.1% / 4.5% / 1.1% / 0.28% です。竜の涙はまれです。
- **出品の中身**：`mode = auction`、`qty = 1`、開始価格は発掘品の目安の価値（`RELIC_VALUE`：1,500 / 4,000 / 10,000 / 25,000 / 60,000 / 100,000）で、入札の上限はありません。`seller_id = '0'`（`TEIAI_SELLER_ID`。スノーフレークではないので、実在のアカウントと重なりません）。エスクローはありません。発掘品は、何もないところから出ます（**アイテムの供給源**。ギルドごと・1日あたりの目安の価値の平均は約 5,133）。
- **1日1回、冪等**：その日の印は、出品テーブルそのものです。`teiaiDaily(guildId)` は、`created_at >= UTC のその日の始まり` の帝愛の出品を数え、足りない分だけを、1つのトランザクションの中で出します。2回目の実行、再起動、同じデータベースに対する2つのインスタンスでも、それ以上は出ません。1分ごとのプレイヤーマーケットのジョブ（`runPlayerMarketSettleTick`。結果の `relicListed`）から動き、状態が `denied` のギルドは飛ばします。
- **通常の競りの決まりがそのまま効きます**：入札ごとに +5%（最低 +100）、締切5分前のスナイプ対策の延長、入札の預かり（`marketplace_hold`）と、抜かれたときの返金（`marketplace_release`）、猶予・破産のときの本人の入札の引き戻し。帝愛の出品の購入・入札は、2者間の 24 時間 100,000 の上限（`PAIR_DAILY_LIMIT`）に**数えず、止められもしません**（帝愛は組む相手のプレイヤーではなく、送金の抜け道になりません）。
- **精算**（`settleExpired`）：
  - 売れたとき：落札者の預かった入札額が、代金のすべてです。それは**戻らない流出（シンク）**で、**帝愛銀行の収入**になります（`teiai.bankIncome(price)`、サーモスタットあり）。売り手への支払い（`marketplace_auction_sale`）も、手数料（`marketplace_fee`）も、送金の行もありません。発掘品は落札者に渡ります。行は `sold`、`fee = 0` です。
  - 売れ残りのとき：行は `expired` になり、何も渡さず、お金も動きません（帝愛が引き取るので、発掘品は消えます）。
  - 元のボットの「落札者が受け取れなければ、返金して帝愛が引き取る」という分岐は、ここにはありません。発掘品には受け取りの上限がなく（ユニークでも馬でもない）、`deliverAsset` が失敗しないためです。
- **勝者の投稿はなし**：リマスターは、どのプレイヤーマーケットの競りでも、落札の投稿をしません。元の `…落札しました（出品者 🕴️ 帝愛）。` の投稿に当たるものはなく、落札者は、持ち物に発掘品が入っているのを見ます。
- **プレイヤーは触れません**：`cancelListing` は `marketplace_not_seller` を返し、`pullBackForUser` は、出品者がそのユーザーの出品だけを動かします。
- **告知**：出品すると、ドメインイベント `TeiaiRelicListed` を（コミット後に）出します。ソケットではギルド全体に届きます。告知担当が、ギルドのチャンネルに、帝愛銀行のペルソナで埋め込みを投稿します（タイトル `🕴️ 帝愛の出品: {item}`、開始価格、締切、マーケット画面への起動ボタン）。ほかの告知と同じく、ギルドごとに既定でオンです。
- **画面**：Activity のマーケット（プレイヤータブ）では、帝愛の出品の出品者が `🕴️ 帝愛` と出て、`帝愛の発掘品` のタグと、マーケットの説明の下に説明の1行が付きます。出品一覧の API は `seller.id = '0'` を返し、画面は `TEIAI_SELLER_ID` で見分けます。
- **不変条件**（`tests/invariants`。コマンド `teiaiRelic`、`relicBid`、`relicSettle`）：帝愛の出品は、ギルドごと・UTC の1日あたり `perDay` 件まで。それぞれ、★なしの発掘品1つの、24時間以上の競り。帝愛の出品の台帳の行は `marketplace_hold` / `marketplace_release` だけ（売却・手数料・送金は決してない）。出品に預かった額は、進行中は現在の入札額、売れたら落札額、売れ残りなら 0 に等しい。持ち物の発掘品の数は、帝愛の売却の数に等しい。

## タイマーとスケジュール
- **30 秒の精算ループ（`P2PCog.tick`）**：期限切れ・終了した出品を精算し、終了した告知の投稿を編集してボタンを外し（`post_done = 1`）、オークションの落札の告知を投稿します。
- **ビューのタイムアウト**：`DetailView`、`SellView`、`MineView` ＝ `300s`、`ConfirmView` ＝ `30s`。

## 状態機械
- 出品：`active` → `sold`（固定価格の購入、またはオークションの落札）| `cancelled`（売り手の取り消し、または強制的な引き戻し）| `expired`（売れ残りのタイムアウト、または、落札者が受け取りと 2 者間の上限の確認に失敗）。

## エッジケース
- P2P で馬を売ると、買い手の `MAX_HORSES` の上限に数えられます（入札の時点と、精算の時点の両方で確認します）。
- 売り手の純額の受け取りは `income = price - fee` で `AccountCore.apply` に渡されます。出品中に売り手が帝愛の債務を抱えた場合は、売却の純額の 30% が天引きされます。
- 入札のエスクローは、`総資産`（`assets.py`）の `escrow` に出ます。出品中のアイテム、発掘品、馬は、売れるまで売り手の固定資産に数えられます。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `p2p.post_title` | `📣 出品: {label}` | `cogs/p2p/embeds.py:88` |
| `p2p.detail_title` | `🤝 {label}` | `cogs/p2p/embeds.py:70` |
| `p2p.btn_open` | `🔍 見る・買う・入札` | `cogs/p2p/views.py:27` |
| `p2p.btn_buy` / `bid` | `🛒 買う` / `🔨 入札する` | `cogs/p2p/views.py:75` |
| `p2p.btn_modes` | `💴 定価で出す` / `🔨 競りに出す` | `cogs/p2p/views.py:186` |
| `p2p.sell_title` | `📤 出品する` | `cogs/p2p/views.py:193` |
| `p2p.mine_title` | `📋 自分の取引` | `cogs/p2p/views.py:245` |
| `p2p.won_announce` | `🔨 競りの落札` / `**{label}** を、<@{buyer}> が **{price}** で落札しました（出品者 <@{seller}>）。` | `cogs/p2p/cog.py:297-298` |
| `p2p.ended_sold` | `✅ 売れました` / `{label} は、<@{buyer}> が **{price}** で買いました。` | `cogs/p2p/embeds.py:74` |
| `p2p.ended_expired` | `⏳ 終了（売れ残り）` / `{label} は、買い手がつかず、終了しました。` | `cogs/p2p/embeds.py:75` |
| `p2p.ended_cancelled` | `🚫 取り消されました` / `{label} の出品は、取り消されました。` | `cogs/p2p/embeds.py:76` |
| `p2p.err_grace` | `破産猶予中は、取引（出品・買う・入札）ができません（破産の前に、資産を移して、借金を踏み倒すのを防ぐためです）。` | `cogs/shared/messages/economy.py:85` |
| `p2p.err_pair_limit` | `同じ相手との取引は、24時間で合計 {limit:,}ペリカ までです（いま {used:,}ペリカ・今回 {amount:,}ペリカ）。` | `cogs/shared/messages/economy.py:173-174` |
| `p2p.err_price_range` | `値段は {lo:,}〜{hi:,}ペリカ にしてください（定価の幅に収めます）。` | `cogs/shared/messages/economy.py:183` |
| `p2p.ledger_buy` / `sell` | `取引:購入（{label}）` / `取引:売却（{label}）` | `infra/db/p2p.py:221,258` |
| `p2p.teiai_seller`（リマスター） | `🕴️ 帝愛` | `screen.finance.listings.sellerTeiai` |
| `p2p.teiai_post_title`（リマスター） | `🕴️ 帝愛の出品: {item}` | `notify.event.TeiaiRelicListed.title` |
| `p2p.teiai_help`（リマスター） | `🕴️ 帝愛も1日（UTC）に1回、発掘品を1つ競りで出す（開始は目安の価値、24時間。掘れる確率どおりに選ぶので、竜の涙はまれ）。代金は帝愛銀行へ` | `screen.finance.listings.teiaiHint` |
| `p2p.ledger_bid` / `refund` | `取引:入札（{label}）` / `取引:入札の返金（{label}）` | `infra/db/p2p.py:284,288,391` |
