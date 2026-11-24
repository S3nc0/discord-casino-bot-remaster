# Owner Testing Checklist

**English** | [日本語](OWNER_TESTING.ja.md)

Run this checklist right after finishing the [Owner Setup Guide](OWNER_SETUP.md) and again after every update to make sure everything works on desktop and mobile.

> [!CAUTION]
> **Never share secrets.** When taking screenshots or copying logs for a bug report, never include your **Bot Token** (`DISCORD_TOKEN`), **OAuth2 Client Secret** (`DISCORD_CLIENT_SECRET`), **`SESSION_SECRET`**, or your `.env` file.

---

## 1. Before You Test

1. Make sure **Terminal 1** (`pnpm dev:server`) and **Terminal 2** (your tunnel) are both running.
2. If you restarted a **quick tunnel** (`pnpm dev:tunnel:quick`), copy the new `xxxx.trycloudflare.com` host, update `/api` to `xxxx.trycloudflare.com/api` under **Developer Portal → your app → Activities → URL Mappings**, and click **Save Changes**.
3. Reload Discord:
   - **Desktop:** press `Cmd+R` (macOS) or `Ctrl+R` (Windows/Linux).
   - **Mobile:** swipe Discord closed and reopen it completely.

✅ **Expected:** Both terminals are running without crash messages, and Discord has refreshed your latest mappings.
**If it fails:** Follow [Owner Setup Guide — Steps 6 and 7](OWNER_SETUP.md#6-set-up-the-tunnel).

---

## 2. Health Checks

In a third Terminal tab, run all three checks (replace `<tunnel-host>` and `APP_ID` with your values):

1. Local server:

   ```sh
   curl -i http://localhost:3001/api/health
   ```

2. Cloudflare tunnel:

   ```sh
   curl -i https://<tunnel-host>/api/health
   ```

3. Discord URL mapping:

   ```sh
   curl -i https://APP_ID.discordsays.com/.proxy/api/health
   ```

✅ **Expected:** All three return HTTP `200` and JSON starting with `{"status":"ok","db":"ok",...}`.
**If it fails:**
- Check #1 fails → Terminal 1 (`pnpm dev:server`) is not running or crashed.
- Check #2 fails → Terminal 2 (tunnel) is stopped or `<tunnel-host>` is outdated.
- Check #3 fails → `/api` in **Activities → URL Mappings** does not match `<tunnel-host>/api` (no `https://`, no trailing slash).

---

## 3. Desktop Launch

1. In your test server on Desktop Discord, open the Activity:
   - **Voice channel:** join a voice channel → click the **Activities** (rocket) icon → pick your app.
   - **Text channel:** click the **Apps** button next to the message box → pick your app → click **Launch** (or run `/launch`).
2. On first launch, click **Authorize** when Discord asks for permission.

✅ **Expected:** The Activity opens on the **Home** screen, displays your account and balance (**3,000 Pelica** for a new player), and the connection indicator shows connected/OK.
**If it fails:** Look at Terminal 1 for an `auth rejected: <reason>` line and check [Owner Setup Guide — Troubleshooting](OWNER_SETUP.md#10-troubleshooting).

---

## 4. Mobile Launch (iOS / Android)

1. Open Discord on your phone and join a voice channel (or open a text channel) in your test server.
2. Launch the Activity:
   - **Voice channel:** open the voice panel → tap the **Activities** (rocket) icon → pick your app.
   - **Text channel:** tap the **`+`** / **Apps** button → pick your app → tap **Launch**.
3. Check the layout in **portrait** mode, then rotate your phone to **landscape** mode and check again.
4. Tap every tab on the bottom navigation bar.

✅ **Expected:**
- The Activity launches without an OS error.
- Nothing is hidden behind Discord's top bar or the phone's home indicator.
- All text and numbers are clear and easy to read.
- The bottom navigation bar switches screens cleanly in both portrait and landscape.

**If it fails:**
- If the phone says the Activity is not available on this OS, check **Developer Portal → Activities → Settings → Supported Platforms** → tick **iOS** and **Android**, leave orientation unlocked, click **Save Changes**, and fully restart Discord on your phone ([Step 4.3](OWNER_SETUP.md#43-enable-activities)).
- If text is cut off or hard to read, take a screenshot and report it (see Step 9).

---

## 5. Theme (Light and Dark)

1. In Discord, switch between Light and Dark mode: **User Settings** (gear icon) → **Appearance** → switch between **Light** and **Dark**.
2. Inside the Activity, open **Settings** and test the in-app **Theme** setting (**Light**, **Dark**, and **Auto**).

> [!NOTE]
> Discord does not report its Light/Dark setting to Activities. When the in-app theme is set to **Auto**, the Activity follows your **device's** system Light/Dark setting instead.

✅ **Expected:** Both Light and Dark themes apply immediately inside the Activity, and all text, buttons, and icons remain readable.
**If it fails:** Note which screen and theme had low contrast or did not switch, take a screenshot, and report it.

---

## 6. Language (`EN ⇄ 日本語`)

1. Inside the Activity, open **Settings → Language**.
2. Switch from **English** to **日本語**, then back to **English**.
3. Switch to **Auto** and confirm it matches your Discord client language.
4. Trigger a toast/notification (for example by saving a setting) while in each language.

✅ **Expected:** Every visible label changes immediately, including headings, the bottom navigation bar, and toast messages; **Auto** follows the Discord client language.
**If it fails:** Write down any words that stayed in the wrong language and report them.

---

## 7. Saved Settings Persistence

1. Inside the Activity, open **Settings**.
2. Toggle the **Sound** and **Animation** settings to new values.
3. Close the Activity completely, then launch it again.
4. Open **Settings** and check those two toggles.

✅ **Expected:** Your **Sound** and **Animation** choices stay saved after closing and reopening the Activity.
**If it fails:** Check Terminal 1 for any errors on `/api/settings` and include them in a report.

---

## 8. Server Log Check (Terminal 1)

Look at the log lines in **Terminal 1** while you use the Activity:

- **Normal lines (no action needed):** startup messages, HTTP `200` requests, and `proxy signature: present=absent`.
  - `proxy signature: present=absent` is **normal**. Discord does not send proxy signature headers on Activity traffic in our setup, so no action is required.
- **Problem lines:** any line containing `auth rejected: <reason>` or an unhandled error.

✅ **Expected:** No `auth rejected:` or error lines appear during normal testing.
**If it fails:** Match `<reason>` in [Owner Setup Guide — Troubleshooting](OWNER_SETUP.md#10-troubleshooting).

---

## 9. How to Report a Problem

If any check fails and the troubleshooting table does not fix it, share:

1. **What failed:** which checklist step and what happened instead.
2. **Terminal 1 log line:** copy the exact `auth rejected: <reason>` or error line (never copy `.env` or any secrets).
3. **Device and screenshot:** Desktop, iOS, or Android, plus a screenshot (crop out anything private).
4. **Steps to repeat it:** 2–3 short numbered steps showing what you clicked or tapped.

---

## 10. Chat Commands (Wave 2)

Do [Owner Setup Guide — Step 8](OWNER_SETUP.md#8-turn-the-chat-bot-on) first: the old Python bot is stopped, `BOT_DISABLED=0`, the server is running, and `pnpm commands:deploy:guild` has been run. Run these in a text channel of your test server. Open the Activity next to the chat so you can compare numbers. Command names are shown in English, and Japanese Discord shows the Japanese names in brackets.

- [ ] **Balance matches the Activity.** `/pelica balance` (`/ペリカ 残高`) shows the same balance as the Activity's **Home** screen.
- [ ] **Daily.** `/pelica daily` (`/ペリカ デイリー`) pays the daily bonus once. Running it again right away says to wait. The balance in the Activity updates to match.
- [ ] **Transfer.** `/pelica transfer` (`/ペリカ 送金`) sends a small amount to another member (or a second test account). Both balances change by the same amount.
- [ ] **A casino game.** `/casino slots` (`/カジノ スロット`) with a small bet. The reply shows the result, and the balance changes by the win or loss.
- [ ] **Horse stable.** `/horse stable` (`/競馬 厩舎`) opens your stable without an error (an empty stable is fine).
- [ ] **A market order.** `/market order` (`/証券 注文`) places a small order. The reply confirms it, and the cash and holdings change as expected.
- [ ] **A loan offer.** `/loan offer` (`/貸付 提案`) to another member shows the offer. They can see it, and nothing moves until they accept.
- [ ] **Announcement channel.** `/admin notifications` (`/運営 通知設定`) with `channel` set to a test channel, and the big-win threshold set low (for example `1000`). Then win a game that pays at least the threshold. A big-win announcement posts in that channel.
- [ ] **Opt-in DM.** If you have turned on DMs for a kind of notification, the bot sends you a direct message when that event happens. Without the opt-in, no DM arrives.
- [ ] **Inbox.** The same event appears in the Activity's inbox, whether or not you opted in to the DM.
- [ ] **Language.** Switch Discord to Japanese: command names and replies are Japanese. Switch back to English: they are English.

✅ **Expected:** Every command answers within a few seconds, with no `The application did not respond` message, and every balance matches between chat and Activity.
**If it fails:** Match the symptom in [Owner Setup Guide — Troubleshooting](OWNER_SETUP.md#10-troubleshooting). If it is not there, report it (Step 9).

---

## 11. Games, Stream Panel, Name Colour and Wealthy Badge

Short checks for the features added after the chat commands. They use your test server and, for the stream panel, a second account (the streamer cannot tip or bet on their own stream). Keep the Activity open next to the chat to compare balances.

- [ ] **An Activity game round.** In the Activity, open **Casino**, pick a game (for example **Slots**), place a small bet and play one round. The result shows, the balance changes by exactly the win or loss, and the same balance shows in `/pelica balance` (`/ペリカ 残高`).
- [ ] **Stream panel: super chat.** The streamer runs `/stream start` (`/配信 開始`) with a title. The second account presses **Super chat**, enters `100` and confirms. The streamer's balance goes up, the sender's goes down by the amount plus the fee, and the panel total changes.
- [ ] **Stream panel: a round that settles.** The streamer opens **Streamer menu → Start a round**. The second account presses **Bet on a win** and bets `100`. The streamer presses **Close the bets**, then **Won** and **Confirm**. The second account is paid out, or refunded if nobody bet on the other side. Trying **Won** before closing the bets is refused. Then the streamer presses **End the stream**.
- [ ] **Name colour gives the role.** Give your account enough Pelica to buy a name colour (`/admin grant`, see [Owner Admin Guide](OWNER_ADMIN.md)), then buy one from `/shop` (`/ショップ`) → **🌈 Name colors** and wear it (or **Inventory → Wear** in the Activity). A role named `ペリカ・<colour>` appears on you under *Server Settings → Roles*, directly below the bot's role, and your name shows that colour. Take the colour off: the role goes away from you within about 30 seconds. If nothing happens, see [Owner Setup Guide — Name colours](OWNER_SETUP.md#name-colours-manage-roles-and-the-bots-role).
- [ ] **The Wealthy badge shows.** With no debt, give your account enough Pelica to reach a net worth of `1,000,000` (for example `/admin grant` with `amount:1000000`). 🟡 appears next to your name on `/pelica balance`, `/pelica bank` (`/ペリカ 帝愛`), `/pelica ranking` (`/ペリカ ランキング`) and in the Activity **Bank**, **Profile** and **Ranking** screens. It is display only: nothing else changes for you.

✅ **Expected:** Every balance matches between chat and Activity, the stream round pays out as described, the colour role is added and removed, and 🟡 shows once the net worth is reached.
**If it fails:** Match the symptom in [Owner Setup Guide — Troubleshooting](OWNER_SETUP.md#10-troubleshooting). If it is not there, report it (Step 9).
