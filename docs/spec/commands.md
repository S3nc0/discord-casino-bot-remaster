**English** | [日本語](commands.ja.md)

# Slash Command Specification (`commands`)

Single source of truth for all Discord slash commands, subcommand groups, subcommands, options, bounds, choices, contexts, and default ephemerality. `apps/server/src/bot/commands.ts` generates the discord.js command tree directly from this specification.

## Conventions

- **Base names** are English lowercase (`[a-z0-9-]`, max 32 chars) so Discord `interaction.commandName` / subcommand names are deterministic.
- **Japanese localizations** (`name_localizations.ja`, `description_localizations.ja`) preserve the original Japanese command names, option names, choices, and descriptions verbatim from the legacy bot.
- **`/help`** keeps `ja: "help"` as its localized name to match the original `/help` command referenced in specs (`admin.md`, `economy-core.md`).
- **Legacy redirects/merges**:
  - `/暗号` was consolidated into `/証券 注文 現物` (`cs` ticker) in legacy (`docs/spec/crypto.md`).
  - `/債券` was consolidated into `/証券 注文 債券` and `/証券 保有` in legacy (`docs/spec/stocks.md`).
- **New in remaster**: `/settings` (`設定`) manages per-user preferences (`UserSettings`, starting with `language`).
- **Context**: `guild` = server channels only; `dm` = Bot DMs / private channels only (`/admin` / `/運営`); `any` = servers and DMs (`/help`, `/settings`).
- **Ephemeral**: Default response visibility for the command's primary success response. Validation/permission errors and "coming soon" stubs always reply ephemerally (`MessageFlags.Ephemeral`).

## Top-Level Groups & Commands

| Command | JA Name | EN Description | JA Description | Context | Owner |
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
| `/stream` | `配信` | Post a stream panel for super chats and win/lose bets | 📺 配信パネルを出して、スパチャや勝敗の賭けを受ける | `guild` | `stream` |
| `/help` | `help` | Beginner's guide with interactive topic buttons | 📖 はじめての人向けの案内（ボタンでくわしい説明） | `any` | `help` |
| `/settings` | `設定` | View or update your personal language and app preferences | ⚙️ 言語などの個人設定を確認・変更する | `any` | `settings` |
| `/admin` | `運営` | [Admin] Bot owner server, economy & event controls (DM only) | [管理者] Bot を使えるサーバーの管理。Bot とのDMで使えます | `dm` | `admin` |

## Complete Command Matrix

### 1. Core Economy & Teiai (`/pelica` / `/ペリカ`)

| Command Path | JA Path | Options (`name` / `JA` : type, bounds, choices) | Ephemeral | Owning Module |
| --- | --- | --- | --- | --- |
| `pelica balance` | `ペリカ 残高` | `member` / `対象`: user (optional) | `false` | `economy` (implemented) |
| `pelica daily` | `ペリカ デイリー` | — | `false` (`true` on wait/memo) | `economy` (`daily`) |
| `pelica repay` | `ペリカ 返済` | `amount` / `金額`: integer, min `1` (optional) | `true` | `teiai` |
| `pelica bank` | `ペリカ 帝愛` | — | `true` | `teiai` |
| `pelica bankrupt` | `ペリカ 破産` | — | `false` (after confirm) | `teiai` |
| `pelica missions` | `ペリカ ミッション` | — | `true` | `economy` (`missions`) |
| `pelica ranking` | `ペリカ ランキング` | `view` / `表示`: string choices (`weekly` / `📅 週間（ゲームの損益）`, `net` / `🏆 純資産`, `liquid` / `💧 流動資産`) (optional, default `weekly`); `member` / `内訳`: user (optional) | `false` (`true` if `member` set with `net` / `liquid`) | `economy` (`ranking`, [economy-core.md §3](economy-core.md#3-balance-sheet-net-assets-純資産-current-assets-流動資産-total-assets-総資産)) |
| `pelica leaderboard` | `ペリカ ランキング掲示` | `channel` / `チャンネル`: channel (optional); `stop` / `止める`: boolean (optional) | `true` | `economy` (`boards`, Manage Guild or Owner) |
| `pelica transfer` | `ペリカ 送金` | `member` / `相手`: user (required); `amount` / `金額`: integer, `1..1000000`, autocomplete (required) | `false` (`true` on confirm) | `economy` (`transfer`) |
| `pelica history` | `ペリカ 履歴` | — | `true` | `economy` (`history`) |

### 2. Casino Games (`/casino` / `/カジノ`)

| Command Path | JA Path | Options (`name` / `JA` : type, bounds, choices) | Ephemeral | Owning Module |
| --- | --- | --- | --- | --- |
| `casino chinchiro` | `カジノ チンチロ` | `bet` / `賭け金`: integer, min `10`, autocomplete (required) | `false` | `casino` (`chinchiro`) |
| `casino chinchiro-table` | `カジノ チンチロ卓` | `bet` / `賭け金`: integer, min `10`, autocomplete (required) | `false` | `casino` (`chinchiro-table`) |
| `casino pachinko` | `カジノ パチンコ` | `bet` / `賭け金`: integer, min `10`, autocomplete (required); `sets` / `回数`: integer, `1..10` (optional) | `false` | `casino` (`pachinko`) |
| `casino slots` | `カジノ スロット` | `bet` / `賭け金`: integer, min `10`, autocomplete (required) | `false` | `casino` (`slots`) |
| `casino blackjack` | `カジノ ブラックジャック` | `bet` / `賭け金`: integer, min `10`, autocomplete (required) | `false` | `casino` (`blackjack`) |
| `casino roulette` | `カジノ ルーレット` | `bet` / `賭け金`: integer, min `10`, autocomplete (required); `kind` / `賭け方`: string choices (`red`/`black`/`even`/`odd`/`low`/`high`/`dozen1`/`dozen2`/`dozen3`/`number`) (required); `number` / `数字`: integer `0..36` (optional) | `false` | `casino` (`roulette`) |

### 3. Horse Racing, Arena & Labor (`/horse`, `/arena`, `/labor`)

| Command Path | JA Path | Options (`name` / `JA` : type, bounds, choices) | Ephemeral | Owning Module |
| --- | --- | --- | --- | --- |
| `horse stable` | `競馬 厩舎` | — | `true` | `horse` |
| `horse card` | `競馬 出馬表` | — | `true` | `horse` |
| `arena tournament` | `闘技場 大会` | `format` / `形式`: string choices (`duel` / `🥊 1on1`, `royale` / `⚔️ バトルロイヤル`) (required) | `false` | `arena` |
| `labor work` | `地下 作業` | — | `false` | `labor` |
| `labor ranking` | `地下 ランキング` | `period` / `期間`: string choices (`total` / `通算`, `today` / `今日`) (optional) | `false` | `labor` |

### 4. Quiz, Polls & Shop (`/quiz`, `/poll`, `/shop`)

| Command Path | JA Path | Options (`name` / `JA` : type, bounds, choices) | Ephemeral | Owning Module |
| --- | --- | --- | --- | --- |
| `quiz play` | `クイズ 挑戦` | — | `true` | `quiz` |
| `quiz post` | `クイズ 出題` | — | `true` (modal) | `quiz` |
| `quiz withdraw` | `クイズ 取り下げ` | `quiz_id` / `番号`: integer, autocomplete (required) | `true` | `quiz` |
| `poll create` | `投票 作成` | `title` / `議題`: string, length `1..200` (required); `duration` / `期限`: string (optional) | `false` | `poll` |
| `shop` | `ショップ` | — | `true` | `shop` |

### 5. Securities Market (`/market` / `/証券`)

Subcommand group `market order` (`証券 注文`): trade spot, margin, call/put options, pair warrants, naked writes, and bonds.

Symbol choices (`SYMBOL_CHOICES`): `cs` (`🪙 CSトークン`), `teio` (`🏭 TEIO重工`), `numa` (`🧪 NUMAバイオ`), `gold` (`🥇 GOLD地金`).
Period choices (`PERIOD_CHOICES`): `1h` (`1時間`), `6h` (`6時間`), `24h` (`24時間`), `7d` (`7日`).

| Command Path | JA Path | Options (`name` / `JA` : type, bounds, choices) | Ephemeral | Owning Module |
| --- | --- | --- | --- | --- |
| `market board` | `証券 市況` | `symbol` / `銘柄`: string choices (optional); `period` / `期間`: string choices (optional) | `true` (summary) / `false` (live chart) | `market` |
| `market holdings` | `証券 保有` | — | `true` | `market` |
| `market settle` | `証券 決済` | `position` / `ポジション`: string, autocomplete (required); `percent` / `割合`: integer `1..100`, autocomplete (optional) | `false` | `market` |
| `market order spot` | `証券 注文 現物` | `symbol` / `銘柄`: string choices (required); `amount` / `金額`: integer `10..1000000`, autocomplete (required) | `false` | `market` |
| `market order margin` | `証券 注文 信用` | `symbol` / `銘柄`: string choices (required); `side` / `売買`: string choices (`long` / `信用買い（上がると利益）`, `short` / `空売り（下がると利益）`) (required); `amount` / `証拠金`: integer `10..10000000`, autocomplete (required); `leverage` / `レバレッジ`: integer choices (`1`/`2`/`3`/`5`) (optional) | `false` | `market` |
| `market order call` | `証券 注文 コール` | `symbol` / `銘柄`: string choices (required); `amount` / `掛け金`: integer `10..10000000`, autocomplete (required); `target` / `目標割合`: integer `1..50` (optional) | `false` | `market` |
| `market order put` | `証券 注文 プット` | `symbol` / `銘柄`: string choices (required); `amount` / `掛け金`: integer `10..10000000`, autocomplete (required); `target` / `目標割合`: integer `1..50` (optional) | `false` | `market` |
| `market order pair` | `証券 注文 ペア` | `symbol` / `銘柄`: string choices (required); `counterpart` / `相手`: string choices (required); `amount` / `掛け金`: integer `10..10000000`, autocomplete (required) | `false` | `market` |
| `market order write` | `証券 注文 裸売り` | `symbol` / `銘柄`: string choices (required); `kind` / `種別`: string choices (`call` / `コール裸売り（上がると損）`, `put` / `プット裸売り（下がると損）`) (required); `amount` / `証拠金`: integer `10..10000000`, autocomplete (required); `target` / `目標割合`: integer `1..50` (optional) | `false` | `market` |
| `market order bond` | `証券 注文 債券` | `kind` / `種類`: string choices (`normal` / `通常債（3日・約4%・元本保証）`, `junk` / `ジャンク債（1日・約20%・20%倒産）`) (required); `amount` / `金額`: integer `10..10000000`, autocomplete (required) | `false` | `bonds` |

### 6. P2P Loans, Kyosai & Companies (`/loan`, `/kyosai`, `/company`)

| Command Path | JA Path | Options (`name` / `JA` : type, bounds, choices) | Ephemeral | Owning Module |
| --- | --- | --- | --- | --- |
| `loan offer` | `貸付 提案` | `member` / `相手`: user (required); `principal` / `金額`: integer min `100`, autocomplete (required); `rate` / `日利`: number min `0` (required); `days` / `期間`: integer `1..30` (required) | `false` | `loan` |
| `loan request` | `貸付 募集` | `principal` / `金額`: integer min `100` (required); `rate` / `日利`: number min `0` (required); `days` / `期間`: integer `1..30` (required) | `false` | `loan` |
| `loan repay` | `貸付 返済` | `loan_id` / `貸付`: integer, autocomplete (required); `amount` / `金額`: integer `1..10000000` (optional) | `false` | `loan` |
| `loan list` | `貸付 一覧` | — | `false` | `loan` |
| `kyosai status` | `共済 状況` | — | `true` | `kyosai` |
| `kyosai bid` | `共済 入札` | `amount` / `金額`: integer `1..1000000000` (required) | `true` | `kyosai` |
| `kyosai offer` | `共済 譲渡` | `member` / `相手`: user (required); `units` / `口数`: integer `1..10000` (required); `price` / `値段`: integer `0..100000` (required) | `false` | `kyosai` |
| `kyosai accept` | `共済 受諾` | `offer_id` / `番号`: integer (required) | `false` | `kyosai` |
| `kyosai cancel` | `共済 取消` | `offer_id` / `番号`: integer (required) | `true` | `kyosai` |
| `kyosai propose` | `共済 提案` | `premium` / `上乗せ金利`: number `0.001..100` (required) | `false` | `kyosai` |
| `kyosai vote` | `共済 投票` | `choice` / `賛否`: string choices (`yes` / `賛成`, `no` / `反対`) (required); `motion_id` / `番号`: integer (optional) | `true` | `kyosai` |
| `company found` | `会社 設立` | `name` / `社名`: string length `1..12` (required); `kind` / `事業所`: string choices (`farm` / `🌾 農場`, `mine` / `⛏ 採掘場`) (required) | `false` | `company` |
| `company status` | `会社 状況` | — | `true` | `company` |
| `company invest` | `会社 出資` | `owner` / `社長`: user (required); `amount` / `金額`: integer min `1000` (required) | `false` | `company` |
| `company dividend` | `会社 配当率` | `percent` / `割合`: integer `0..100` (required) | `true` | `company` |
| `company holdings` | `会社 持分` | — | `true` | `company` |

### 7. Stream Panel (`/stream` / `/配信`)

| Command Path | JA Path | Options (`name` / `JA` : type, bounds, choices) | Ephemeral | Owning Module |
| --- | --- | --- | --- | --- |
| `stream start` | `配信 開始` | `title` / `タイトル`: string, length `1..100` (required); `url` / `url`: string, max length `300` (`http://` or `https://`, optional) | `false` (posts the live panel with persistent buttons) | `stream` ([stream.md](stream.md)) |

### 8. Help & Settings (`/help`, `/settings`)

| Command Path | JA Path | Options (`name` / `JA` : type, bounds, choices) | Ephemeral | Owning Module |
| --- | --- | --- | --- | --- |
| `help` | `help` | — | `true` | `bot` (implemented) |
| `settings` | `設定` | `language` / `言語`: string choices (`auto`, `en`, `ja`) (optional) | `true` | `settings` (implemented) |

### 9. Admin Tools (`/admin` / `/運営` — DM Only, `OWNER_IDS` Gate)

| Command Path | JA Path | Options (`name` / `JA` : type, bounds, choices) | Ephemeral | Owning Module |
| --- | --- | --- | --- | --- |
| `admin grant` | `運営 付与` | `guild_id` / `サーバー`: string autocomplete (required); `user_id` / `ユーザー`: string autocomplete (required); `amount` / `金額`: integer `1..10000000` (required); `reason` / `理由`: string (optional) | `true` | `admin` |
| `admin set-balance` | `運営 残高設定` | `guild_id` / `サーバー`: string autocomplete (required); `user_id` / `ユーザー`: string autocomplete (required); `amount` / `金額`: integer `-1000000000..1000000000` (required); `reason` / `理由`: string (optional) | `true` | `admin` |
| `admin pachinko-stats` | `運営 パチンコ統計` | `guild_id` / `サーバー`: string autocomplete (optional); `days` / `日数`: integer `1..365` (optional) | `true` | `admin` |
| `admin click-history` | `運営 クリック履歴` | `guild_id` / `サーバー`: string autocomplete (required); `user_id` / `ユーザー`: string autocomplete (required); `hours` / `時間`: integer `1..336` (optional) | `true` | `admin` |
| `admin host-race` | `運営 競馬開催` | `guild_id` / `サーバー`: string autocomplete (required); `entry_min` / `申し込み分`: integer `1..120` (optional); `bet_min` / `発売分`: integer `1..120` (optional); `channel_id` / `チャンネル`: string autocomplete (optional) | `true` | `admin` |
| `admin host-arena` | `運営 闘技場開催` | `guild_id` / `サーバー`: string autocomplete (required); `advance` / `即決着`: boolean (optional); `fmt` / `形式`: string choices (`duel`/`royale`) (optional); `channel_id` / `チャンネル`: string autocomplete (optional) | `true` | `admin` |
| `admin announce` | `運営 お知らせ` | `guild_id` / `サーバー`: string autocomplete (optional); `image` / `画像`: attachment (optional); `title` / `見出し`: string (optional); `channel_id` / `チャンネル`: string autocomplete (optional) | `true` | `admin` |
| `admin purge-messages` | `運営 発言削除` | `guild_id` / `サーバー`: string autocomplete (required); `channel_id` / `チャンネル`: string autocomplete (required) | `true` | `admin` |
| `admin server-list` | `運営 サーバー一覧` | — | `true` | `admin` |
| `admin server-allow` | `運営 サーバー許可` | `guild_id` / `サーバーid`: string (required) | `true` | `admin` |
| `admin server-revoke` | `運営 サーバー取消` | `guild_id` / `サーバーid`: string (required) | `true` | `admin` |
| `admin event start` | `運営 イベント 開始` | `game` / `ゲーム`: string choices (5 casino games) (required); `minutes` / `時間`: integer `1..180` (optional); `boost` / `上乗せ率`: integer `1..300` (optional); `guild_id` / `サーバー`: string autocomplete (optional); `channel_id` / `チャンネル`: string autocomplete (optional) | `true` | `admin` |
| `admin event stop` | `運営 イベント 終了` | `guild_id` / `サーバー`: string autocomplete (optional) | `true` | `admin` |
| `admin rtp set` | `運営 還元率 設定` | `guild_id` / `サーバー`: string autocomplete (required); `game` / `ゲーム`: string choices (`*` + 5 casino games) (required); `level` / `レベル`: integer choices (`1..6`) (required) | `true` | `admin` |
| `admin rtp list` | `運営 還元率 一覧` | `guild_id` / `サーバー`: string autocomplete (optional) | `true` | `admin` |
| `admin feature off` | `運営 機能 停止` | `guild_id` / `サーバー`: string autocomplete (required); `feature` / `機能`: string choices (`*` + 18 features) (required) | `true` | `admin` |
| `admin feature on` | `運営 機能 再開` | `guild_id` / `サーバー`: string autocomplete (required); `feature` / `機能`: string choices (`*` + 18 features) (required) | `true` | `admin` |
| `admin feature list` | `運営 機能 一覧` | `guild_id` / `サーバー`: string autocomplete (optional) | `true` | `admin` |
| `admin raffle start` | `運営 抽選 開催` | `guild_id` / `サーバー`: string autocomplete (required); `fee` / `掛金`: integer min `500` (optional); `minutes` / `募集時間`: integer `1..1440` (optional); `channel_id` / `チャンネル`: string autocomplete (optional) | `true` | `admin` |
| `admin raffle repost` | `運営 抽選 再掲示` | `guild_id` / `サーバー`: string autocomplete (required); `channel_id` / `チャンネル`: string autocomplete (optional) | `true` | `admin` |
| `admin raffle cancel` | `運営 抽選 中止` | `guild_id` / `サーバー`: string autocomplete (required) | `true` | `admin` |
| `admin quiz add` | `運営 クイズ 追加` | `announce` / `告知`: integer choices (`1` / `する`, `0` / `しない`) (optional); `guild_id` / `サーバー`: string autocomplete (optional); `channel_id` / `チャンネル`: string autocomplete (optional) | `true` | `admin` |
| `admin quiz bulk` | `運営 クイズ 一括追加` | `file` / `ファイル`: attachment (required); `announce` / `告知`: integer choices (`0` / `しない`, `1` / `する`) (optional); `guild_id` / `サーバー`: string autocomplete (optional); `channel_id` / `チャンネル`: string autocomplete (optional) | `true` | `admin` |
| `admin quiz list` | `運営 クイズ 一覧` | — | `true` | `admin` |
| `admin quiz delete` | `運営 クイズ 削除` | `quiz_id` / `番号`: integer (required) | `true` | `admin` |
