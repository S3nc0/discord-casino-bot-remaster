[English](commands.md) | **日本語**

# スラッシュコマンド仕様（`commands`）

Discord のスラッシュコマンド、サブコマンドグループ、サブコマンド、オプション、範囲、選択肢、コンテキスト、既定の公開範囲（エフェメラル）を、すべてまとめた唯一の情報源です。`apps/server/src/bot/commands.ts` は、この仕様から discord.js のコマンドツリーを直接生成します。

## 規約

- **基本名**は英語の小文字（`[a-z0-9-]`、32 文字まで）にします。こうすると、Discord の `interaction.commandName` やサブコマンド名が確定的になります。
- **日本語ローカライズ**（`name_localizations.ja`、`description_localizations.ja`）では、旧ボットのコマンド名、オプション名、選択肢、説明を原文のまま保ちます。
- **`/help`** は、仕様（`admin.md`、`economy-core.md`）が参照する元の `/help` コマンドに合わせて、ローカライズ名を `ja: "help"` のままにします。
- **旧版からの転送・統合**：
  - `/暗号` は、旧版で `/証券 注文 現物`（`cs` 銘柄）に統合されました（`docs/spec/crypto.ja.md`）。
  - `/債券` は、旧版で `/証券 注文 債券` と `/証券 保有` に統合されました（`docs/spec/stocks.ja.md`）。
- **リマスターでの新規**：`/settings`（`設定`）で、ユーザーごとの設定（`UserSettings`。最初は `language`）を管理します。
- **コンテキスト**：`guild` ＝ サーバーのチャンネルのみ。`dm` ＝ Bot との DM／プライベートチャンネルのみ（`/admin` / `/運営`）。`any` ＝ サーバーと DM の両方（`/help`、`/settings`）。
- **エフェメラル**：そのコマンドの主な成功レスポンスの既定の公開範囲です。入力や権限のエラーと、「近日公開」のスタブは、常にエフェメラルで返します（`MessageFlags.Ephemeral`）。

## トップレベルのグループとコマンド

| コマンド | 日本語名 | 英語の説明 | 日本語の説明 | コンテキスト | 担当 |
| --- | --- | --- | --- | --- | --- |
| `/pelica` | `ペリカ` | Balance, daily bonus, ranking, transfers & Teiai Bank | 💴 残高・デイリー・ランキング・送金 | `guild` | `economy` / `teiai` |
| `/casino` | `カジノ` | Play casino games with Pelica (virtual currency) | 🎰 ペリカを賭けて遊ぶ（遊びのゲーム用の仮想通貨です） | `guild` | `casino` |
| `/horse` | `競馬` | Raise racehorses, enter races & buy betting tickets | 🏇 競走馬を育てて走らせる・馬券を買う（毎日2回） | `guild` | `horse` |
| `/arena` | `闘技場` | Underground arena: daily 1on1 & battle royale betting | 🏛️ 地下闘技場（1日1回、1on1・バトロワの両方を開催・NPC戦士に賭ける） | `guild` | `arena` |
| `/labor` | `地下` | Underground labor to earn Pelica from zero | ⛏ ペリカが尽きたときの、地下の仕事 | `guild` | `labor` |
| `/quiz` | `クイズ` | Answer 4-choice trivia quizzes for Pelica rewards | 📰 時事ネタ・豆知識の4択に答えて、正解でペリカをもらう | `guild` | `quiz` |
| `/poll` | `投票` | Create yes/no polls anyone can vote on | 🗳️ 誰でも作れる、賛成・反対の投票 | `guild` | `poll` |
| `/shop` | `ショップ` | Browse, buy & equip items, titles, skins and auctions | 🛍️ 景品を見る・買う・身につける（ボタンで操作） | `guild` | `shop` |
| `/market` | `証券` | Trade stocks, margin, options, warrants & bonds | 📈 注文・保有・市況・決済（4銘柄と債券。ゲーム内の通貨・現実のお金とは無関係） | `guild` | `market` |
| `/loan` | `貸付` | Peer-to-peer Pelica loans with daily simple interest | 🤝 ペリカの貸し借り（日割りの単利つき） | `guild` | `loan` |
| `/kyosai` | `共済` | Teiai Kyosai mutual shares, auctions, transfers & motions | 🏛️ 帝愛共済（配当と、最後の損の負担・口の競りと譲渡・動議） | `guild` | `kyosai` |
| `/company` | `会社` | Found a Teiai subsidiary, produce goods & take stakes | 🏢 会社（帝愛の子会社を作って、製品を売る） | `guild` | `company` |
| `/help` | `help` | Beginner's guide with interactive topic buttons | 📖 はじめての人向けの案内（ボタンでくわしい説明） | `any` | `help` |
| `/settings` | `設定` | View or update your personal language and app preferences | ⚙️ 言語などの個人設定を確認・変更する | `any` | `settings` |
| `/admin` | `運営` | [Admin] Bot owner server, economy & event controls (DM only) | [管理者] Bot を使えるサーバーの管理。Bot とのDMで使えます | `dm` | `admin` |

## コマンド一覧（全体）

### 1. 経済の中核と帝愛（`/pelica` / `/ペリカ`）

| コマンドのパス | 日本語のパス | オプション（`name` / `日本語`：型、範囲、選択肢） | エフェメラル | 担当モジュール |
| --- | --- | --- | --- | --- |
| `pelica balance` | `ペリカ 残高` | `member` / `対象`: user（任意） | `false` | `economy`（実装済み） |
| `pelica daily` | `ペリカ デイリー` | — | `false`（待ち時間やメモのときは `true`） | `economy`（`daily`） |
| `pelica repay` | `ペリカ 返済` | `amount` / `金額`: integer、最小 `1`（任意） | `true` | `teiai` |
| `pelica bank` | `ペリカ 帝愛` | — | `true` | `teiai` |
| `pelica bankrupt` | `ペリカ 破産` | — | `false`（確認のあと） | `teiai` |
| `pelica missions` | `ペリカ ミッション` | — | `true` | `economy`（`missions`） |
| `pelica ranking` | `ペリカ ランキング` | `member` / `内訳`: user（任意） | `false`（`member` を指定したときは `true`） | `economy`（`ranking`） |
| `pelica leaderboard` | `ペリカ ランキング掲示` | `channel` / `チャンネル`: channel（任意）、`stop` / `止める`: boolean（任意） | `true` | `economy`（`boards`。サーバー管理権限かオーナー） |
| `pelica transfer` | `ペリカ 送金` | `member` / `相手`: user（必須）、`amount` / `金額`: integer、`1..1000000`、オートコンプリート（必須） | `false`（確認のときは `true`） | `economy`（`transfer`） |
| `pelica history` | `ペリカ 履歴` | — | `true` | `economy`（`history`） |

### 2. カジノゲーム（`/casino` / `/カジノ`）

| コマンドのパス | 日本語のパス | オプション（`name` / `日本語`：型、範囲、選択肢） | エフェメラル | 担当モジュール |
| --- | --- | --- | --- | --- |
| `casino chinchiro` | `カジノ チンチロ` | `bet` / `賭け金`: integer、最小 `10`、オートコンプリート（必須） | `false` | `casino`（`chinchiro`） |
| `casino chinchiro-table` | `カジノ チンチロ卓` | `bet` / `賭け金`: integer、最小 `10`、オートコンプリート（必須） | `false` | `casino`（`chinchiro-table`） |
| `casino pachinko` | `カジノ パチンコ` | `bet` / `賭け金`: integer、最小 `10`、オートコンプリート（必須）、`sets` / `回数`: integer、`1..10`（任意） | `false` | `casino`（`pachinko`） |
| `casino slots` | `カジノ スロット` | `bet` / `賭け金`: integer、最小 `10`、オートコンプリート（必須） | `false` | `casino`（`slots`） |
| `casino blackjack` | `カジノ ブラックジャック` | `bet` / `賭け金`: integer、最小 `10`、オートコンプリート（必須） | `false` | `casino`（`blackjack`） |
| `casino roulette` | `カジノ ルーレット` | `bet` / `賭け金`: integer、最小 `10`、オートコンプリート（必須）、`kind` / `賭け方`: string の選択肢（`red`/`black`/`even`/`odd`/`low`/`high`/`dozen1`/`dozen2`/`dozen3`/`number`）（必須）、`number` / `数字`: integer `0..36`（任意） | `false` | `casino`（`roulette`） |

### 3. 競馬、闘技場、地下労働（`/horse`、`/arena`、`/labor`）

| コマンドのパス | 日本語のパス | オプション（`name` / `日本語`：型、範囲、選択肢） | エフェメラル | 担当モジュール |
| --- | --- | --- | --- | --- |
| `horse stable` | `競馬 厩舎` | — | `true` | `horse` |
| `horse card` | `競馬 出馬表` | — | `true` | `horse` |
| `arena tournament` | `闘技場 大会` | `format` / `形式`: string の選択肢（`duel` / `🥊 1on1`、`royale` / `⚔️ バトルロイヤル`）（必須） | `false` | `arena` |
| `labor work` | `地下 作業` | — | `false` | `labor` |
| `labor ranking` | `地下 ランキング` | `period` / `期間`: string の選択肢（`total` / `通算`、`today` / `今日`）（任意） | `false` | `labor` |

### 4. クイズ、投票、ショップ（`/quiz`、`/poll`、`/shop`）

| コマンドのパス | 日本語のパス | オプション（`name` / `日本語`：型、範囲、選択肢） | エフェメラル | 担当モジュール |
| --- | --- | --- | --- | --- |
| `quiz play` | `クイズ 挑戦` | — | `true` | `quiz` |
| `quiz post` | `クイズ 出題` | — | `true`（モーダル） | `quiz` |
| `quiz withdraw` | `クイズ 取り下げ` | `quiz_id` / `番号`: integer、オートコンプリート（必須） | `true` | `quiz` |
| `poll create` | `投票 作成` | `title` / `議題`: string、長さ `1..200`（必須）、`duration` / `期限`: string（任意） | `false` | `poll` |
| `shop` | `ショップ` | — | `true` | `shop` |

### 5. 証券市場（`/market` / `/証券`）

サブコマンドグループ `market order`（`証券 注文`）：現物、信用取引、コール／プットのオプション、ペア・ワラント、裸売り、債券を取引します。

銘柄の選択肢（`SYMBOL_CHOICES`）：`cs`（`🪙 CSトークン`）、`teio`（`🏭 TEIO重工`）、`numa`（`🧪 NUMAバイオ`）、`gold`（`🥇 GOLD地金`）。
期間の選択肢（`PERIOD_CHOICES`）：`1h`（`1時間`）、`6h`（`6時間`）、`24h`（`24時間`）、`7d`（`7日`）。

| コマンドのパス | 日本語のパス | オプション（`name` / `日本語`：型、範囲、選択肢） | エフェメラル | 担当モジュール |
| --- | --- | --- | --- | --- |
| `market board` | `証券 市況` | `symbol` / `銘柄`: string の選択肢（任意）、`period` / `期間`: string の選択肢（任意） | `true`（サマリー）／`false`（ライブチャート） | `market` |
| `market holdings` | `証券 保有` | — | `true` | `market` |
| `market settle` | `証券 決済` | `position` / `ポジション`: string、オートコンプリート（必須）、`percent` / `割合`: integer `1..100`、オートコンプリート（任意） | `false` | `market` |
| `market order spot` | `証券 注文 現物` | `symbol` / `銘柄`: string の選択肢（必須）、`amount` / `金額`: integer `10..1000000`、オートコンプリート（必須） | `false` | `market` |
| `market order margin` | `証券 注文 信用` | `symbol` / `銘柄`: string の選択肢（必須）、`side` / `売買`: string の選択肢（`long` / `信用買い（上がると利益）`、`short` / `空売り（下がると利益）`）（必須）、`amount` / `証拠金`: integer `10..10000000`、オートコンプリート（必須）、`leverage` / `レバレッジ`: integer の選択肢（`1`/`2`/`3`/`5`）（任意） | `false` | `market` |
| `market order call` | `証券 注文 コール` | `symbol` / `銘柄`: string の選択肢（必須）、`amount` / `掛け金`: integer `10..10000000`、オートコンプリート（必須）、`target` / `目標割合`: integer `1..50`（任意） | `false` | `market` |
| `market order put` | `証券 注文 プット` | `symbol` / `銘柄`: string の選択肢（必須）、`amount` / `掛け金`: integer `10..10000000`、オートコンプリート（必須）、`target` / `目標割合`: integer `1..50`（任意） | `false` | `market` |
| `market order pair` | `証券 注文 ペア` | `symbol` / `銘柄`: string の選択肢（必須）、`counterpart` / `相手`: string の選択肢（必須）、`amount` / `掛け金`: integer `10..10000000`、オートコンプリート（必須） | `false` | `market` |
| `market order write` | `証券 注文 裸売り` | `symbol` / `銘柄`: string の選択肢（必須）、`kind` / `種別`: string の選択肢（`call` / `コール裸売り（上がると損）`、`put` / `プット裸売り（下がると損）`）（必須）、`amount` / `証拠金`: integer `10..10000000`、オートコンプリート（必須）、`target` / `目標割合`: integer `1..50`（任意） | `false` | `market` |
| `market order bond` | `証券 注文 債券` | `kind` / `種類`: string の選択肢（`normal` / `通常債（3日・約4%・元本保証）`、`junk` / `ジャンク債（1日・約20%・20%倒産）`）（必須）、`amount` / `金額`: integer `10..10000000`、オートコンプリート（必須） | `false` | `bonds` |

### 6. 個人間融資、共済、会社（`/loan`、`/kyosai`、`/company`）

| コマンドのパス | 日本語のパス | オプション（`name` / `日本語`：型、範囲、選択肢） | エフェメラル | 担当モジュール |
| --- | --- | --- | --- | --- |
| `loan offer` | `貸付 提案` | `member` / `相手`: user（必須）、`principal` / `金額`: integer、最小 `100`、オートコンプリート（必須）、`rate` / `日利`: number、最小 `0`（必須）、`days` / `期間`: integer `1..30`（必須） | `false` | `loan` |
| `loan request` | `貸付 募集` | `principal` / `金額`: integer、最小 `100`（必須）、`rate` / `日利`: number、最小 `0`（必須）、`days` / `期間`: integer `1..30`（必須） | `false` | `loan` |
| `loan repay` | `貸付 返済` | `loan_id` / `貸付`: integer、オートコンプリート（必須）、`amount` / `金額`: integer `1..10000000`（任意） | `false` | `loan` |
| `loan list` | `貸付 一覧` | — | `false` | `loan` |
| `kyosai status` | `共済 状況` | — | `true` | `kyosai` |
| `kyosai bid` | `共済 入札` | `amount` / `金額`: integer `1..1000000000`（必須） | `true` | `kyosai` |
| `kyosai offer` | `共済 譲渡` | `member` / `相手`: user（必須）、`units` / `口数`: integer `1..10000`（必須）、`price` / `値段`: integer `0..100000`（必須） | `false` | `kyosai` |
| `kyosai accept` | `共済 受諾` | `offer_id` / `番号`: integer（必須） | `false` | `kyosai` |
| `kyosai cancel` | `共済 取消` | `offer_id` / `番号`: integer（必須） | `true` | `kyosai` |
| `kyosai propose` | `共済 提案` | `premium` / `上乗せ金利`: number `0.001..100`（必須） | `false` | `kyosai` |
| `kyosai vote` | `共済 投票` | `choice` / `賛否`: string の選択肢（`yes` / `賛成`、`no` / `反対`）（必須）、`motion_id` / `番号`: integer（任意） | `true` | `kyosai` |
| `company found` | `会社 設立` | `name` / `社名`: string、長さ `1..12`（必須）、`kind` / `事業所`: string の選択肢（`farm` / `🌾 農場`、`mine` / `⛏ 採掘場`）（必須） | `false` | `company` |
| `company status` | `会社 状況` | — | `true` | `company` |
| `company invest` | `会社 出資` | `owner` / `社長`: user（必須）、`amount` / `金額`: integer、最小 `1000`（必須） | `false` | `company` |
| `company dividend` | `会社 配当率` | `percent` / `割合`: integer `0..100`（必須） | `true` | `company` |
| `company holdings` | `会社 持分` | — | `true` | `company` |

### 7. ヘルプと設定（`/help`、`/settings`）

| コマンドのパス | 日本語のパス | オプション（`name` / `日本語`：型、範囲、選択肢） | エフェメラル | 担当モジュール |
| --- | --- | --- | --- | --- |
| `help` | `help` | — | `true` | `bot`（実装済み） |
| `settings` | `設定` | `language` / `言語`: string の選択肢（`auto`、`en`、`ja`）（任意） | `true` | `settings`（実装済み） |

### 8. 管理コマンド（`/admin` / `/運営`。DM のみ、`OWNER_IDS` で制限）

| コマンドのパス | 日本語のパス | オプション（`name` / `日本語`：型、範囲、選択肢） | エフェメラル | 担当モジュール |
| --- | --- | --- | --- | --- |
| `admin grant` | `運営 付与` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`user_id` / `ユーザー`: string、オートコンプリート（必須）、`amount` / `金額`: integer `1..10000000`（必須）、`reason` / `理由`: string（任意） | `true` | `admin` |
| `admin set-balance` | `運営 残高設定` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`user_id` / `ユーザー`: string、オートコンプリート（必須）、`amount` / `金額`: integer `-1000000000..1000000000`（必須）、`reason` / `理由`: string（任意） | `true` | `admin` |
| `admin pachinko-stats` | `運営 パチンコ統計` | `guild_id` / `サーバー`: string、オートコンプリート（任意）、`days` / `日数`: integer `1..365`（任意） | `true` | `admin` |
| `admin click-history` | `運営 クリック履歴` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`user_id` / `ユーザー`: string、オートコンプリート（必須）、`hours` / `時間`: integer `1..336`（任意） | `true` | `admin` |
| `admin host-race` | `運営 競馬開催` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`entry_min` / `申し込み分`: integer `1..120`（任意）、`bet_min` / `発売分`: integer `1..120`（任意）、`channel_id` / `チャンネル`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin host-arena` | `運営 闘技場開催` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`advance` / `即決着`: boolean（任意）、`fmt` / `形式`: string の選択肢（`duel`/`royale`）（任意）、`channel_id` / `チャンネル`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin announce` | `運営 お知らせ` | `guild_id` / `サーバー`: string、オートコンプリート（任意）、`image` / `画像`: attachment（任意）、`title` / `見出し`: string（任意）、`channel_id` / `チャンネル`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin purge-messages` | `運営 発言削除` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`channel_id` / `チャンネル`: string、オートコンプリート（必須） | `true` | `admin` |
| `admin server-list` | `運営 サーバー一覧` | — | `true` | `admin` |
| `admin server-allow` | `運営 サーバー許可` | `guild_id` / `サーバーid`: string（必須） | `true` | `admin` |
| `admin server-revoke` | `運営 サーバー取消` | `guild_id` / `サーバーid`: string（必須） | `true` | `admin` |
| `admin event start` | `運営 イベント 開始` | `game` / `ゲーム`: string の選択肢（5 つのカジノゲーム）（必須）、`minutes` / `時間`: integer `1..180`（任意）、`boost` / `上乗せ率`: integer `1..300`（任意）、`guild_id` / `サーバー`: string、オートコンプリート（任意）、`channel_id` / `チャンネル`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin event stop` | `運営 イベント 終了` | `guild_id` / `サーバー`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin rtp set` | `運営 還元率 設定` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`game` / `ゲーム`: string の選択肢（`*` と 5 つのカジノゲーム）（必須）、`level` / `レベル`: integer の選択肢（`1..6`）（必須） | `true` | `admin` |
| `admin rtp list` | `運営 還元率 一覧` | `guild_id` / `サーバー`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin feature off` | `運営 機能 停止` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`feature` / `機能`: string の選択肢（`*` と 18 の機能）（必須） | `true` | `admin` |
| `admin feature on` | `運営 機能 再開` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`feature` / `機能`: string の選択肢（`*` と 18 の機能）（必須） | `true` | `admin` |
| `admin feature list` | `運営 機能 一覧` | `guild_id` / `サーバー`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin raffle start` | `運営 抽選 開催` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`fee` / `掛金`: integer、最小 `500`（任意）、`minutes` / `募集時間`: integer `1..1440`（任意）、`channel_id` / `チャンネル`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin raffle repost` | `運営 抽選 再掲示` | `guild_id` / `サーバー`: string、オートコンプリート（必須）、`channel_id` / `チャンネル`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin raffle cancel` | `運営 抽選 中止` | `guild_id` / `サーバー`: string、オートコンプリート（必須） | `true` | `admin` |
| `admin quiz add` | `運営 クイズ 追加` | `announce` / `告知`: integer の選択肢（`1` / `する`、`0` / `しない`）（任意）、`guild_id` / `サーバー`: string、オートコンプリート（任意）、`channel_id` / `チャンネル`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin quiz bulk` | `運営 クイズ 一括追加` | `file` / `ファイル`: attachment（必須）、`announce` / `告知`: integer の選択肢（`0` / `しない`、`1` / `する`）（任意）、`guild_id` / `サーバー`: string、オートコンプリート（任意）、`channel_id` / `チャンネル`: string、オートコンプリート（任意） | `true` | `admin` |
| `admin quiz list` | `運営 クイズ 一覧` | — | `true` | `admin` |
| `admin quiz delete` | `運営 クイズ 削除` | `quiz_id` / `番号`: integer（必須） | `true` | `admin` |
