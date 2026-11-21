# Roulette (`roulette`)

European single-zero roulette (`0`–`36`) (`/カジノ ルーレット`).
Shared contract alignment: `GameId = 'roulette'`, `ScreenId = 'roulette'`, `LEDGER_REASONS` (`game_stake`, `game_payout`, `game_refund`, `jackpot_payout`, `debt_withholding`). See [casino-common.md](./casino-common.md).

## Source Files

- `catalogs/games.yaml:36-69,151-160`
- `catalogs/skins.yaml:120-126`
- `legacy/python/domain/games/roulette.py:1-53`
- `legacy/python/domain/games/rtplevel.py:66-74,84`
- `legacy/python/cogs/casino/cog.py:94-124`
- `legacy/python/cogs/casino/simple.py:92-142`
- `legacy/python/cogs/casino/texts.py:8-18`

## Rules & Exact Numbers

### Wheel & Colors
- Pocket drawn uniformly: `rng.randint(0, 36)` (37 pockets).
- `RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}` (18 pockets).
- `0` → `"緑"` (`🟢`); `n in RED` → `"赤"` (`🔴`); otherwise → `"黒"` (`⚫`).

### Bet Types, Odds & Payouts (`BETS`, `wins`, `payout`)
`0` loses on every bet type except `number` (straight on `0`).

| Kind ID | Label | Winning Pockets | Win Prob | Total Payout Mult | Exact Base RTP | `W` (Win Share) |
|---|---|---|---|---|---|---|
| `red` | `赤` | `n ∈ RED` (18) | `18/37` | `2×` | `36/37` (`97.297%`) | `18/37` |
| `black` | `黒` | `n ∉ RED ∧ n ≠ 0` (18) | `18/37` | `2×` | `36/37` (`97.297%`) | `18/37` |
| `even` | `偶数` | `n ≠ 0 ∧ n % 2 == 0` (18) | `18/37` | `2×` | `36/37` (`97.297%`) | `18/37` |
| `odd` | `奇数` | `n % 2 == 1` (18) | `18/37` | `2×` | `36/37` (`97.297%`) | `18/37` |
| `low` | `1〜18` | `1 ≤ n ≤ 18` (18) | `18/37` | `2×` | `36/37` (`97.297%`) | `18/37` |
| `high` | `19〜36` | `19 ≤ n ≤ 36` (18) | `18/37` | `2×` | `36/37` (`97.297%`) | `18/37` |
| `dozen1` | `1〜12` | `1 ≤ n ≤ 12` (12) | `12/37` | `3×` | `36/37` (`97.297%`) | `24/37` |
| `dozen2` | `13〜24` | `13 ≤ n ≤ 24` (12) | `12/37` | `3×` | `36/37` (`97.297%`) | `24/37` |
| `dozen3` | `25〜36` | `25 ≤ n ≤ 36` (12) | `12/37` | `3×` | `36/37` (`97.297%`) | `24/37` |
| `number` | `ストレート（数字）` | `n == number` (1) | `1/37` | `36×` | `36/37` (`97.297%`) | `35/37` |

- `payout = bet * mult` if `wins(...)` else `0`.
- RTP level adjustment passes `rtp_kind=kind` (`simple.py:117`), so `factor` uses that specific bet kind's `W` (`18/37`, `24/37`, or `35/37`).

### Validation, Limits & Timers
- `MIN_BET = 10`, no max bet.
- Pre-escrow validation (`simple.py:96-109`):
  - `kind == "number"` requires `number` in `0..36`.
  - `kind != "number"` rejects any provided `number`.
- Animation: 3 frames at `SIMPLE_STEP_SECONDS = 0.9s` (2 random preview numbers + final result). Settled prior to animation.
- Replay view timeout: `90s`, preserving `(kind, number)`.

## State Machine

```text
IDLE -> [validate kind/number] -> [start_game: lock + escrow] -> SPIN_AND_SETTLE
SPIN_AND_SETTLE -> [3 frames × 0.9s] -> FINAL + ReplayView(90s) -> RELEASED
```

## Edge Cases

- `number == 0` with `kind == "number"` wins `36×` (green straight).
- `number` passed with non-straight `kind` is rejected before taking escrow.
- Preview numbers shown during animation are decorative random draws unrelated to final `result`.

## User-Facing Japanese Strings

| Key | Verbatim Text | Source |
|---|---|---|
| `roulette.cmd.desc` | `🎡 色・偶奇・範囲・数字に賭ける` | `cogs/casino/cog.py:94` |
| `roulette.kind.desc` | `赤黒・偶奇などは2倍、範囲(12個)は3倍、数字ぴったりは36倍` | `cogs/casino/cog.py:98` |
| `roulette.number.desc` | `「ストレート（数字）」のときだけ 0〜36 を指定` | `cogs/casino/cog.py:99` |
| `roulette.choice.red` | `赤（2倍）` | `cogs/casino/cog.py:103` |
| `roulette.choice.black` | `黒（2倍）` | `cogs/casino/cog.py:104` |
| `roulette.choice.even` | `偶数（2倍）` | `cogs/casino/cog.py:105` |
| `roulette.choice.odd` | `奇数（2倍）` | `cogs/casino/cog.py:106` |
| `roulette.choice.low` | `1〜18（2倍）` | `cogs/casino/cog.py:107` |
| `roulette.choice.high` | `19〜36（2倍）` | `cogs/casino/cog.py:108` |
| `roulette.choice.dozen1` | `1〜12（3倍）` | `cogs/casino/cog.py:109` |
| `roulette.choice.dozen2` | `13〜24（3倍）` | `cogs/casino/cog.py:110` |
| `roulette.choice.dozen3` | `25〜36（3倍）` | `cogs/casino/cog.py:111` |
| `roulette.choice.number` | `ストレート（数字・36倍）` | `cogs/casino/cog.py:112` |
| `roulette.title` | `🎡 ルーレット` | `cogs/casino/simple.py:118` |
| `roulette.err.need_num_title` | `数字が必要です` | `cogs/casino/simple.py:99` |
| `roulette.err.need_num_body` | `「ストレート（数字）」を選んだときは、0〜36 の数字も指定してください。` | `cogs/casino/simple.py:99` |
| `roulette.err.no_num_title` | `数字は不要です` | `cogs/casino/simple.py:106` |
| `roulette.err.no_num_body` | `数字を指定するのは「ストレート（数字）」のときだけです。` | `cogs/casino/simple.py:106` |
| `roulette.bet_head` | `あなたの賭け: **{name}**` | `cogs/casino/simple.py:118` |
| `roulette.verdict.win` | `当たり🎉` | `cogs/casino/simple.py:119` |
| `roulette.verdict.lose` | `ハズレ` | `cogs/casino/simple.py:119` |
| `roulette.anim.1` | `ボールが回り出した…` | `cogs/casino/simple.py:128` |
| `roulette.anim.2` | `ボールが跳ねている… \`{n}\`` | `cogs/casino/simple.py:130` |
| `roulette.anim.3` | `もうすぐ止まる… \`{n}\`` | `cogs/casino/simple.py:131` |
| `roulette.result.title` | `{title} — {emoji} **{result}**（{color}） {verdict}　{signed_net}ペリカ` | `cogs/casino/simple.py:122` |
