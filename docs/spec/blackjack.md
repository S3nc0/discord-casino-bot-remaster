**English** | [日本語](blackjack.ja.md)

# Blackjack (`blackjack`)

Single-deck Blackjack (`/カジノ ブラックジャック`) with Hit, Stand, Double Down (including Teiai credit double), no Split, no Blackjack Insurance.
Shared contract alignment: `GameId = 'blackjack'`, `ScreenId = 'blackjack'`, `LEDGER_REASONS` (`game_stake`, `game_payout`, `game_refund`, `jackpot_payout`, `debt_withholding`, `loan_borrow`). See [casino-common.md](./casino-common.md).

## Source Files

- `catalogs/games.yaml:70-73,151-159`
- `catalogs/skins.yaml:54-61,106-112`
- `docs/teiai.md:15`
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/games/blackjack.py:1-98`
  - `domain/games/rtplevel.py:28,87`
  - `infra/db/escrow.py:51-76`
  - `cogs/casino/cog.py:87-92`
  - `cogs/casino/blackjack.py:1-219`
  - `cogs/casino/texts.py:24-36`

## Rules & Exact Numbers

### Deck & Dealing (`new_deck`, `Game.__post_init__`)
- Standard 52-card single deck: 4 suits (`♠`, `♥`, `♦`, `♣`) × 13 ranks (`A`, `2`–`10`, `J`, `Q`, `K`). Shuffled via `rng.shuffle(deck)`.
- Deal order (`deck.pop()` from end):
  - `player = [pop(), pop()]`
  - `dealer = [pop(), pop()]` (`dealer[0]` is face-up; `dealer[1]` is hidden as `？` while playing).
- Hand valuation (`value(cards)`): `A = 11` (demoted to `1` one at a time while `total > 21`), `J/Q/K = 10`, numeric ranks = face value.
- Natural Blackjack (`is_blackjack`): `len(cards) == 2 and value(cards) == 21`.
  - If either `player` or `dealer` has natural blackjack on initial deal, `finished = True` immediately (no player actions).

### Player Actions & Dealer Rules
- **Hit (`hit`)**: Pop 1 card to `player`. If `value(player) >= 21`, automatically calls `stand()`. Disables Double button after first hit.
- **Stand (`stand`)**: While `value(dealer) < 17 and value(player) <= 21`, pop 1 card to `dealer`. (Dealer stands on all 17s, including soft 17.) Sets `finished = True`.
- **Double (`double`)**: Only allowed when `len(player) == 2 and not doubled`.
  - Attempts `add_to_escrow(gid, eid, bet)` from cash.
  - If cash is insufficient, computes `need = bet - balance` and checks `teiai.can_borrow_for_bet(gid, uid, need)` (not bankrupt, not in bankruptcy grace, `need <= teiai.SEED` = `3,000`).
  - If allowed, prompts confirmation modal (`confirm_action`). On confirm, calls `add_to_escrow(..., credit=True)` which borrows `need` from Teiai (creates debt / underground status) and adds `bet` to escrow.
  - Sets `doubled = True`, pops exactly 1 card to `player`, calls `stand()`.

### Resolution & Payouts (`result`, `payout`)
Priority order in `Game.result()`:
1. `is_blackjack(player)` → `"push"` if `is_blackjack(dealer)` else `"blackjack"`.
2. `is_blackjack(dealer)` → `"lose"`.
3. `p > 21` → `"bust"`.
4. `d > 21 or p > d` → `"win"`.
5. `p == d` → `"push"` else `"lose"`.

Payout (`bet` = total escrow including double):
- `"blackjack"`: `bet * 5 // 2` (3:2, integer floor on odd bets).
- `"win"`: `bet * 2`.
- `"push"`: `bet`.
- `"lose"` / `"bust"`: `0`.

### Mission Tags
- `"natural"` added when `result == "blackjack"`.
- `"double_win"` added when `result in ("win", "blackjack") and game.doubled`.

### Odds & RTP
- Base RTP profile (`rtplevel.py:28`): `BLACKJACK_RTP = 0.918`, `BLACKJACK_W = 0.412` (reference policy: hit to 17).
- Level 1–6 approx RTP: `83.8%` / `87.8%` / `91.8%` / `95.8%` / `99.8%` / `103.8%`.

### Limits & Timers
- `MIN_BET = 10`, no max bet.
- `BlackjackView` timeout: `90s`. On timeout, auto-stands (`game.stand()`) and settles.
- Replay view timeout: `90s`; replay uses `base_bet` (original stake before double).

## State Machine

```text
IDLE -> [start_game: lock + escrow] -> DEAL
DEAL -> [natural BJ on either side] -> SETTLED (immediate)
DEAL -> [no natural] -> PLAYER_FIRST_TURN (Hit / Stand / Double, 90s)
PLAYER_FIRST_TURN -> [Hit & total < 21] -> PLAYER_HIT_TURN (Hit / Stand, Double disabled)
PLAYER_FIRST_TURN -> [Hit & total >= 21] -> DEALER_PLAY -> SETTLED
PLAYER_FIRST_TURN -> [Double (cash or Teiai credit confirm)] -> DEALER_PLAY -> SETTLED
PLAYER_FIRST_TURN / PLAYER_HIT_TURN -> [Stand OR timeout 90s] -> DEALER_PLAY -> SETTLED
```

## Edge Cases

- If player busts on Hit or Double (`p > 21`), dealer does **not** draw (`value(player) <= 21` guard in `stand()`).
- Odd bet natural blackjack truncates via `bet * 5 // 2` (e.g., `bet = 11` → `payout = 27`).
- During Teiai credit double confirmation, if the game times out or finishes before confirmation arrives, the credit call is aborted (`blackjack.py:191-198`).
- Winning on Double upgrades result embed color to `ui.GOLD`.
- Replay button uses `self.base_bet` (not doubled stake).

## User-Facing Japanese Strings

| Key | Verbatim Text | Source |
|---|---|---|
| `blackjack.cmd.desc` | `🃏 21に近づけてディーラーに勝つ（ヒット・スタンド・ダブル）` | `cogs/casino/cog.py:87` |
| `blackjack.title` | `🃏 ブラックジャック` | `cogs/casino/texts.py:24` |
| `blackjack.res.blackjack` | `ブラックジャック！ 3:2 で払い戻し🎉` | `cogs/casino/texts.py:27` |
| `blackjack.res.win` | `勝ち🎉` | `cogs/casino/texts.py:28` |
| `blackjack.res.dealer_bust` | `ディーラーがバースト！ 勝ち🎉` | `cogs/casino/blackjack.py:109` |
| `blackjack.res.push` | `引き分け（賭け金が戻る）` | `cogs/casino/texts.py:29` |
| `blackjack.res.lose` | `負け…` | `cogs/casino/texts.py:30` |
| `blackjack.res.bust` | `バースト…（21を超えた）` | `cogs/casino/texts.py:31` |
| `blackjack.flair.blackjack` | `🃏✨ **ナチュラルブラックジャック！** 最初の2枚で21！` | `cogs/casino/texts.py:34` |
| `blackjack.flair.doubled` | `💥 **ダブルダウン成功！** 倍賭けが当たった！` | `cogs/casino/texts.py:35` |
| `blackjack.flair.21` | `🎯 **21ぴったり！**` | `cogs/casino/texts.py:36` |
| `blackjack.btn.hit` | `ヒット（もう1枚）` | `cogs/casino/blackjack.py:148` |
| `blackjack.btn.stand` | `スタンド（勝負）` | `cogs/casino/blackjack.py:155` |
| `blackjack.btn.double` | `ダブル（倍賭けして1枚）` | `cogs/casino/blackjack.py:162` |
| `blackjack.err.double_title` | `ダブルできません` | `cogs/casino/blackjack.py:170` |
| `blackjack.err.double_first_only` | `ダブルは、最初の2枚のときだけ選べます。` | `cogs/casino/blackjack.py:170` |
| `blackjack.err.double_no_credit` | `倍にするためのペリカが足りません。{reason}` | `cogs/casino/blackjack.py:180` |
| `blackjack.err.double_borrow_fail` | `帝愛から借りられませんでした。` | `cogs/casino/blackjack.py:201` |
| `blackjack.credit.title` | `帝愛の信用でダブルしますか？` | `cogs/casino/blackjack.py:186` |
| `blackjack.credit.body` | `手元が **{need:,}ペリカ** 足りません。足りない分を帝愛から借りて、倍賭けします。\n**借金になり、🟡地下労働者に落ちます**（デイリーのピンハネ・収入の天引きが始まります）。` | `cogs/casino/blackjack.py:187-188` |
| `blackjack.credit.btn` | `借りてダブル` | `cogs/casino/blackjack.py:189` |
| `blackjack.label.doubled` | `　ダブルダウン` | `cogs/casino/blackjack.py:114` |
