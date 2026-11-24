**English** | [日本語](stream.ja.md)

# Streams (`/stream`)

[← Back to README](../README.md) · [Stream spec](spec/stream.md)

Send super chats to someone's stream and bet on whether the streamer wins or loses the next round — in the **Stream** Activity screen or right in Discord chat. Tunable numbers live under `stream:` in `catalogs/economy.yaml`, and payout calculations live in `packages/domain/src/stream/`.

## Stream panel

- Open a panel from the **Stream** tile in the Activity or with `/stream start` in chat, giving a title (1–100 characters) and an optional stream link (`http://` or `https://`). Works for Discord screen shares as well as outside streams like YouTube or Twitch.
- Inside the Activity, stream links open through Discord's external-link prompt.
- If you start the panel from the Activity while in a voice channel, that voice channel is shown on the panel as the location. The bot never creates or deletes channels.
- The panel shows the super-chat total and count, the active round (Win and Lose pools with indicative odds, bettor count, and auto-lock timer), and recent super chats.
- Each streamer can run one live panel per server at a time. Close it with **End stream**; forgotten panels close automatically after **24 hours**, voiding any undecided round and refunding every stake.

## Super chats

- Send a super chat with an amount (from **100 Pelica**) and an optional message (up to **150 characters**).
- Money rules are shared with `/pelica transfer`:
  - **10% fee** (rounded up), paid on top by the sender.
  - **20,000 Pelica daily cap**, shared with regular transfers.
  - Requires at least **3 games played** and **no Teiai debt**.
  - Amounts of **5,000 Pelica or more** ask for confirmation before sending.
  - Streamers cannot send super chats to their own stream.
- Larger amounts display in brighter tier colours: blue (< 500), cyan (500+), mint (1,000+), yellow (2,000+), orange (5,000+), magenta (10,000+), and red (20,000+).

## Win / lose bets

1. The streamer opens a round with an optional name (up to 60 characters; blank uses "Next round").
2. Viewers bet on **Streamer wins** or **Streamer loses**. Stakes are held in escrow until settlement.
3. Bets lock when the streamer clicks **Lock bets**, or automatically **10 minutes** after the round opens.
4. Once bets are locked, the streamer settles the round as **Win** or **Lose** (with a confirmation step). A round can also be **Voided** at any time (open or locked) to refund everyone in full.

Only one round can be active at a time. Ending the stream or hitting the 24-hour auto-close voids any undecided round and refunds every bettor.

### Parimutuel payouts

- Teiai deducts **5%** from the losing side's total pool. Winners receive their full stake back plus a proportional share of the remaining 95% of the losing pool. The deduction and rounding dust go to Teiai Bank.
- Winners never lose money on a winning bet, because the deduction comes only from the losing side.
- If only one side has bets, there is no contest and everyone is refunded in full. No Pelica is created out of thin air.

Example: A bets 1,000 and B bets 3,000 on Win; C bets 2,000 on Lose; the streamer wins. Teiai takes 5% of 2,000 (100), leaving 1,900 split 1:3 between A and B. A receives `1,000 + 475 = 1,475` and B receives `3,000 + 1,425 = 4,425`.

### Fair-play safeguards

Because the streamer calls the outcome, these limits keep manipulation unprofitable:

- The streamer cannot bet on their own round.
- Each viewer can bet **100 to 10,000 Pelica** total per round. You can add to your bet on the same side, but you cannot switch sides once you have bet.
- Players with Teiai debt cannot bet.
- A round **must be locked** before Win or Lose can be declared, preventing late bets after the outcome is known.
- Every settled or voided round is written to the owner audit log, and the server owner can void an undecided round with `/admin stream-void` (with a required reason).

## Pausing the feature

When an owner turns off `stream` with `/admin feature`, new panels, super chats, and bets are paused. Streamers can still lock, settle, void, and end already-open panels so escrowed stakes are never stuck.
