# Owner Admin Guide: Admin Commands and IDs

**English** | [日本語](OWNER_ADMIN.ja.md)

This guide explains what Discord IDs are, how to copy them on desktop and mobile, how to give yourself admin access, and how to use every `/admin` command.

> [!CAUTION]
> **Never share secrets.** Your **Bot Token** (`DISCORD_TOKEN`), **OAuth2 Client Secret** (`DISCORD_CLIENT_SECRET`), **`SESSION_SECRET`**, and `.env` file must stay private. Discord IDs themselves are not passwords, though examples below use fake placeholder numbers (`111111111111111111`).

---

## 1. What Server IDs and User IDs Are

In Discord, every server, user, and channel has a permanent 17–19 digit number called an **ID** (Discord calls a server a **guild**, and calls these numbers *snowflakes*).

- **Server (guild) ID:** Identifies one specific Discord server. Even if you rename the server, its ID never changes.
- **User ID:** Identifies one specific Discord account. Even if someone changes their display name or username, their User ID stays the same.
- **Channel ID:** Identifies one specific text or voice channel inside a server.

The bot and `.env` file use these numbers so commands always target the exact server, player, or channel you intend.

---

## 2. How to Turn On Developer Mode and Copy IDs

Discord hides copy-ID buttons by default. Turn on **Developer Mode** once per device, and you can copy IDs anytime.

### On desktop (macOS / Windows / Linux)

1. Open Discord and click **User Settings** (the gear icon at the bottom-left).
2. Click **Advanced** in the left sidebar and turn on **Developer Mode**.
3. Copy the ID you need:
   - **Server ID:** Right-click the server icon in the left bar → **Copy Server ID**.
   - **User ID:** Right-click a person's name or avatar (including your own) → **Copy User ID**.
   - **Channel ID:** Right-click a text channel → **Copy Channel ID**.

### On phone (iOS / Android)

1. Open the Discord app and tap **You** (your profile icon at the bottom-right).
2. Tap **Settings** (the gear icon at the top-right) → **Advanced** → turn on **Developer Mode**.
3. Copy the ID you need:
   - **Server ID:** Long-press the server icon on the left (or open the server, tap its name at the top → tap **`...`**) → **Copy Server ID**.
   - **User ID:** Tap a person's name or avatar to open their profile → tap **`...`** at the top-right → **Copy User ID**. For your own ID, tap **You** (bottom-right) → tap **`...`** at the top-right → **Copy User ID**.
   - **Channel ID:** Long-press the text channel name → **Copy Channel ID**.

---

## 3. How to Become an Admin (`OWNER_IDS`)

Bot admins (owners) are configured in the `.env` file on your server machine using `OWNER_IDS`.

1. Open `.env` in your project folder (if you have not created it yet, see [Owner Setup Guide — Step 5](OWNER_SETUP.md#5-create-env-on-your-mac)).
2. Set `OWNER_IDS` to your Discord User ID:

   ```sh
   OWNER_IDS=222222222222222222
   ```

   To give admin access to more than one person, list their User IDs **separated by commas** with no spaces or quotes:

   ```sh
   OWNER_IDS=222222222222222222,333333333333333333
   ```

3. Save `.env` and **restart the server** (`Ctrl+C` in Terminal 1, then run `pnpm dev:server` again). `.env` is only read at startup.

> [!NOTE]
> Make sure slash commands have been registered at least once with `pnpm commands:deploy:guild` (see [Owner Setup Guide — Step 8](OWNER_SETUP.md#8-turn-the-chat-bot-on)). Editing `OWNER_IDS` does **not** require re-deploying commands.

---

## 4. Who Can Use `/admin` — and Where

- **Bot owners (`OWNER_IDS`):** Can use **all 26 `/admin` (`/運営`) commands**.
- **Server moderators (`Manage Server` permission):** Can use **`/admin notifications` (`/運営 通知設定`)** inside that server only. They cannot use the other 25 `/admin` commands or change another server's settings.

### DM vs. server channel

- **25 of the 26 commands work only in a Direct Message (DM) with the bot.** If you type `/admin` inside a server channel, Discord only shows `/admin notifications`. To use the rest, click the bot in your server's member list and open a DM with it, then type `/admin` there.
- **`/admin notifications` (`/運営 通知設定`)** works **both in a server channel and in a DM with the bot**. When you run it inside a server, `guild_id` defaults to the current server.

### Tips for filling in options

- **`guild_id` (`サーバー`):** In most commands, typing into `guild_id` shows an autocomplete list of servers the bot knows. For `server-allow` and `server-revoke`, paste the numeric Server ID directly.
- **`user_id` (`ユーザー`):** Fill in `guild_id` first, then `user_id` autocompletes members in that server (or paste a User ID / `@mention`). The target user must already have an account in that server (they must have opened the Activity or run any bot command there at least once).
- **`channel_id` (`チャンネル`):** Paste the numeric Channel ID copied with Developer Mode. Whenever you provide `channel_id`, you must also provide `guild_id`.
- **Confirmations & modals:** All `/admin` replies are private (ephemeral). Commands that overwrite balances, send announcements, delete messages, cancel raffles, delete quizzes, or revoke servers show a confirmation prompt or modal first.

---

## 5. Every `/admin` Command (26 Commands)

In the **Options** column, `*` marks a **required** option. Options without `*` are optional. All examples use fake placeholder IDs (`111111111111111111` = server, `222222222222222222` = user, `333333333333333333` = channel).

### Money (2)

Run in a **DM with the bot** (`OWNER_IDS` only).

| EN command | JA command | Options (EN / JA) | What it does | Example |
| --- | --- | --- | --- | --- |
| `/admin grant` | `/運営 付与` | `*guild_id` (`サーバー`), `*user_id` (`ユーザー`), `*amount` (`金額`: `1`–`10,000,000`), `reason` (`理由`) | Adds Pelica to a member's balance (no withholding) and records an `admin_grant` ledger entry. | `/admin grant guild_id:111111111111111111 user_id:222222222222222222 amount:10000 reason:Event prize` |
| `/admin set-balance` | `/運営 残高設定` | `*guild_id` (`サーバー`), `*user_id` (`ユーザー`), `*amount` (`金額`: `-1,000,000,000`–`1,000,000,000`), `reason` (`理由`) | Asks confirmation, then sets a member's balance directly. A negative number sets cash to `0` and sets Teiai debt to `-amount`. | `/admin set-balance guild_id:111111111111111111 user_id:222222222222222222 amount:5000 reason:Reset` |

### Start games and events (7)

Run in a **DM with the bot** (`OWNER_IDS` only).

| EN command | JA command | Options (EN / JA) | What it does | Example |
| --- | --- | --- | --- | --- |
| `/admin host-race` | `/運営 競馬開催` | `*guild_id` (`サーバー`), `entry_min` (`申し込み分`: `1`–`120`, default `5`), `bet_min` (`発売分`: `1`–`120`, default `5`), `channel_id` (`チャンネル`) | Opens an ad-hoc special horse race and posts an announcement with an Activity launch button. | `/admin host-race guild_id:111111111111111111 entry_min:3 bet_min:5` |
| `/admin host-arena` | `/運営 闘技場開催` | `*guild_id` (`サーバー`), `advance` (`即決着`: true/false, default `false`), `fmt` (`形式`: `duel` / `royale`), `channel_id` (`チャンネル`) | Opens today's arena tournament if not started, or resolves the current round immediately when `advance:true`. | `/admin host-arena guild_id:111111111111111111 advance:false fmt:duel` |
| `/admin event start` | `/運営 イベント 開始` | `*game` (`ゲーム`: `chinchiro`, `pachinko`, `slots`, `blackjack`, `roulette`), `minutes` (`時間`: `1`–`180`, default `30`), `boost` (`上乗せ率`: `1`–`300`%, default `50`), `guild_id` (`サーバー`, default all servers), `channel_id` (`チャンネル`) | Starts a manual casino bonus event (replaces any active manual event; posts an announcement). | `/admin event start game:slots minutes:30 boost:50 guild_id:111111111111111111` |
| `/admin event stop` | `/運営 イベント 終了` | `guild_id` (`サーバー`, default all servers) | Immediately stops the active manual casino bonus event. | `/admin event stop guild_id:111111111111111111` |
| `/admin raffle start` | `/運営 抽選 開催` | `*guild_id` (`サーバー`), `fee` (`掛金`: `>= 500`, default random `500`–`3,000`), `minutes` (`募集時間`: `1`–`1440`, default `60`), `channel_id` (`チャンネル`) | Starts a server ticket-pool raffle and posts a Join button. | `/admin raffle start guild_id:111111111111111111 fee:1000 minutes:30` |
| `/admin raffle repost` | `/運営 抽選 再掲示` | `*guild_id` (`サーバー`), `channel_id` (`チャンネル`) | Reposts the Join panel for the currently open raffle. | `/admin raffle repost guild_id:111111111111111111 channel_id:333333333333333333` |
| `/admin raffle cancel` | `/運営 抽選 中止` | `*guild_id` (`サーバー`) | Asks confirmation, then cancels the active raffle and refunds all entrants. | `/admin raffle cancel guild_id:111111111111111111` |

### Quiz (4)

Run in a **DM with the bot** (`OWNER_IDS` only).

| EN command | JA command | Options (EN / JA) | What it does | Example |
| --- | --- | --- | --- | --- |
| `/admin quiz add` | `/運営 クイズ 追加` | `announce` (`告知`: `1` Yes [default] / `0` No), `guild_id` (`サーバー`), `channel_id` (`チャンネル`) | Opens a modal to add one official 4-choice quiz (question, choices one per line with the right answer first, explanation, reward, duration). | `/admin quiz add announce:1 guild_id:111111111111111111` |
| `/admin quiz bulk` | `/運営 クイズ 一括追加` | `*file` (`ファイル`: UTF-8 `.txt`/`.md`/`.text`, `<= 200 KB`), `announce` (`告知`: `0` No [default] / `1` Yes), `guild_id` (`サーバー`), `channel_id` (`チャンネル`) | Parses a bulk quiz file, previews the questions, and asks confirmation before importing all-or-nothing. | `/admin quiz bulk file:<quizzes.txt> announce:0` |
| `/admin quiz list` | `/運営 クイズ 一覧` | *(none)* | Lists up to 25 currently open quizzes with their IDs, rewards, and answer counts. | `/admin quiz list` |
| `/admin quiz delete` | `/運営 クイズ 削除` | `*quiz_id` (`番号`) | Asks confirmation, then deletes the specified quiz and its history. | `/admin quiz delete quiz_id:12` |

> [!TIP]
> **Bulk quiz file format:** Separate each question block with `---` (lines starting with `#` are comments). Each block needs `問題:` (question), `正解:` (correct answer), three `不正解:` lines (wrong answers), and optional `解説:` (explanation), `報酬:` (reward), and `期限:` (duration, e.g. `1d`).

### Server and game settings (11)

Run in a **DM with the bot** (`OWNER_IDS` only), **except `/admin notifications`**, which also works in a server channel for `Manage Server` moderators and owners.

| EN command | JA command | Options (EN / JA) | What it does | Example |
| --- | --- | --- | --- | --- |
| `/admin notifications` | `/運営 通知設定` | `channel` (`チャンネル`), `threshold` (`大当たり基準`: `0`–`100,000,000`), `personas` (`ペルソナ`: true/false), `enabled` (`告知有効`: true/false), `guild_id` (`サーバー`, optional in a server) | Views or updates a server's announcement channel, big-win threshold, webhook personas, and announcement toggle. Run with no options to view current settings. | `/admin notifications channel:#casino-news threshold:1000 enabled:true` |
| `/admin announce` | `/運営 お知らせ` | `guild_id` (`サーバー`, default all servers), `image` (`画像`: image up to 8 MB), `title` (`見出し`: up to 200 chars), `channel_id` (`チャンネル`) | Opens a modal for the message body, shows a preview, and asks confirmation before posting an embed to servers. | `/admin announce guild_id:111111111111111111 title:Maintenance notice` |
| `/admin purge-messages` | `/運営 発言削除` | `*guild_id` (`サーバー`), `*channel_id` (`チャンネル`) | Asks confirmation, then deletes the bot's own messages in that channel (requires `View Channel` and `Read Message History`). | `/admin purge-messages guild_id:111111111111111111 channel_id:333333333333333333` |
| `/admin rtp set` | `/運営 還元率 設定` | `*guild_id` (`サーバー`), `*game` (`ゲーム`: `*` or one of the 5 casino games), `*level` (`レベル`: `1` Very tight .. `3` Standard .. `6` Generous) | Changes a server's payout RTP level (`1`–`6`) for one or all casino games and replies with the full RTP table. | `/admin rtp set guild_id:111111111111111111 game:* level:3` |
| `/admin rtp list` | `/運営 還元率 一覧` | `guild_id` (`サーバー`, default all servers) | Shows the current RTP levels and approximate RTP percentages for servers (up to 10 embeds). | `/admin rtp list guild_id:111111111111111111` |
| `/admin feature off` | `/運営 機能 停止` | `*guild_id` (`サーバー`), `*feature` (`機能`: `*` or any of the 18 features) | Pauses new starts for a feature in that server (already-started games/bets still settle normally). | `/admin feature off guild_id:111111111111111111 feature:pachinko` |
| `/admin feature on` | `/運営 機能 再開` | `*guild_id` (`サーバー`), `*feature` (`機能`: `*` or any of the 18 features) | Resumes a paused feature in that server. | `/admin feature on guild_id:111111111111111111 feature:pachinko` |
| `/admin feature list` | `/運営 機能 一覧` | `guild_id` (`サーバー`, default all servers) | Shows which features are running (`▶️`) or paused (`⏸️`) in each server. | `/admin feature list guild_id:111111111111111111` |
| `/admin server-list` | `/運営 サーバー一覧` | *(none)* | Shows whether `REQUIRE_APPROVAL` is on/off, joined server count, and approved / pending / denied servers with IDs. | `/admin server-list` |
| `/admin server-allow` | `/運営 サーバー許可` | `*guild_id` (`サーバーid`) | Approves a server ID to use the bot and posts an approved notice if the bot is already in that server. | `/admin server-allow guild_id:111111111111111111` |
| `/admin server-revoke` | `/運営 サーバー取消` | `*guild_id` (`サーバーid`) | Asks confirmation, marks a server denied, and leaves it (refuses servers listed in `.env` `ALLOWED_GUILD_IDS`). | `/admin server-revoke guild_id:111111111111111111` |

### Checks (2)

Run in a **DM with the bot** (`OWNER_IDS` only).

| EN command | JA command | Options (EN / JA) | What it does | Example |
| --- | --- | --- | --- | --- |
| `/admin pachinko-stats` | `/運営 パチンコ統計` | `guild_id` (`サーバー`, default all servers), `days` (`日数`: `1`–`365`, default all time) | Compares actual vs. designed pachinko start rate, set hit rate, RTP, spin hit rate, omen breakdown, and tier breakdown. | `/admin pachinko-stats guild_id:111111111111111111 days:7` |
| `/admin click-history` | `/運営 クリック履歴` | `*guild_id` (`サーバー`), `*user_id` (`ユーザー`), `hours` (`時間`: `1`–`336`, default `24`) | Shows up to 24 hourly rows of a player's underground labor clicks, pay, coefficient of variation (CV), and `⚠️` flags for mechanical click patterns. | `/admin click-history guild_id:111111111111111111 user_id:222222222222222222 hours:24` |

---

## 6. First Five Minutes as Admin (Walkthrough)

Before starting, make sure `OWNER_IDS` in `.env` has your User ID, the server has been restarted, and `pnpm commands:deploy:guild` has been run.

1. **Create your player account in the test server:**
   In a text channel of your test server, run `/pelica balance` (or open the Activity once). This registers your account in that server so admin commands can target you.

2. **Set the announcement channel:**
   Still inside your test server's text channel, run:
   - **EN:** `/admin notifications channel:#your-channel threshold:1000 enabled:true`
   - **JA:** `/運営 通知設定 チャンネル:#your-channel 大当たり基準:1000 告知有効:True`

   The bot replies privately confirming the new announcement channel.

3. **Open a DM with the bot and grant yourself 10,000 Pelica:**
   Click the bot in your server's member list → **Message** to open a DM, then run (using your real server ID and user ID):
   - **EN:** `/admin grant guild_id:111111111111111111 user_id:222222222222222222 amount:10000 reason:Admin smoke test`
   - **JA:** `/運営 付与 サーバー:111111111111111111 ユーザー:222222222222222222 金額:10000 理由:テスト付与`

   Run `/pelica balance` back in your test server to confirm your balance increased by **10,000 Pelica**.

4. **Host a special horse race:**
   In the DM with the bot, run:
   - **EN:** `/admin host-race guild_id:111111111111111111 entry_min:2 bet_min:2`
   - **JA:** `/運営 競馬開催 サーバー:111111111111111111 申し込み分:2 発売分:2`

   Check your announcement channel in the test server — the race notice and Activity button appear right away.

5. **Start a casino bonus event:**
   In the DM with the bot, run:
   - **EN:** `/admin event start game:Slots minutes:15 boost:50 guild_id:111111111111111111`
   - **JA:** `/運営 イベント 開始 ゲーム:スロット 時間:15 上乗せ率:50 サーバー:111111111111111111`

   The bot announces the **+50% Slots** event in your server's announcement channel. When you finish testing, stop it early with `/admin event stop` (`/運営 イベント 終了`).
