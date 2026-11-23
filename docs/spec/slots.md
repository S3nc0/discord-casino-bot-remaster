**English** | [日本語](slots.ja.md)

# Slots (`slots`)

3-reel weighted slot machine (`/カジノ スロット`).
Shared contract alignment: `GameId = 'slots'`, `ScreenId = 'slots'`, `LEDGER_REASONS` (`game_stake`, `game_payout`, `game_refund`, `jackpot_payout`, `debt_withholding`). See [casino-common.md](./casino-common.md).

## Source Files

- `catalogs/games.yaml:13-35,151-155`
- `catalogs/skins.yaml:113-119`
- `legacy/python/domain/games/slot.py:1-55`
- `legacy/python/domain/games/rtplevel.py:32-45,83`
- `legacy/python/cogs/casino/cog.py:80-85`
- `legacy/python/cogs/casino/simple.py:30-88`
- `legacy/python/cogs/casino/texts.py:8`

## Rules & Exact Numbers

### Symbol Weights & Payout Table (`catalogs/games.yaml:13-35`)
Total weight = `10 + 8 + 6 + 4 + 2 + 1 = 31`. Each of the 3 reels is drawn independently with replacement (`rng.choices(SYMBOLS, weights=..., k=3)`).

| Symbol | Weight | Single-Reel Prob | 3-of-a-Kind Prob | 3-of-a-Kind Multiplier |
|---|---|---|---|---|
| `🍒` | `10` | `10/31` | `1000/29791` | `5×` |
| `🍋` | `8` | `8/31` | `512/29791` | `8×` |
| `🍇` | `6` | `6/31` | `216/29791` | `15×` |
| `🔔` | `4` | `4/31` | `64/29791` | `30×` |
| `💎` | `2` | `2/31` | `8/29791` | `100×` |
| `7️⃣` | `1` | `1/31` | `1/29791` | `500×` |

Non-triple cherry payouts (`multiplier(reels)`):
- Exactly 2 `🍒`: `1.5×` (`CHERRY_TWO = 1.5`).
- Exactly 1 `🍒`: `0.3×` (`CHERRY_ONE = 0.3`).
- Anything else: `0×`.

### Payout Rounding, Odds & RTP
- `payout = int(bet * slot.multiplier(reels))` (integer truncation / floor).
- Exact base RTP (`slot.rtp()` over all `31^3 = 29,791` weighted outcomes):
  - Triples: `(1000*5 + 512*8 + 216*15 + 64*30 + 8*100 + 1*500) / 29791 = 15556 / 29791 ≈ 0.522171`
  - 2 cherries: `3 * 10 * 10 * 21 * 1.5 / 29791 = 9450 / 29791 ≈ 0.317210`
  - 1 cherry: `3 * 10 * 21 * 21 * 0.3 / 29791 = 3969 / 29791 ≈ 0.133228`
  - **Total base RTP** = `28975 / 29791 ≈ 0.972609` (97.26%).
  - Note: `CHERRY_ONE` (0.3×) returns `payout < bet`, so `net < 0` and it does **not** trigger insurance (`payout != 0`) and is **not** modified by RTP level (`payout <= bet`).
  - Win-share `SLOT_W = sum(p * max(0, m - 1)) ≈ 0.659461`.

### Limits & Timers
- `MIN_BET = 10`, no max bet.
- Animation: 3 reel-stop frames at `SIMPLE_STEP_SECONDS = 0.9s` intervals (total ~2.7s). Settled before animation plays (`keep_session=True`, released in `finally`).
- Replay buttons timeout: `90s`.

## State Machine

```text
IDLE -> [start_game: lock + escrow] -> SPIN_AND_SETTLE
SPIN_AND_SETTLE -> [frame 0: 🌀🌀🌀 -> 0.9s -> r0🌀🌀 -> 0.9s -> r0r1🌀 -> 0.9s -> final] -> RELEASED
```

## Edge Cases

- `bet = 10` with 1 cherry (`0.3×`): `payout = int(10 * 0.3) = 3`, `net = -7`, `lost = 7` (bank loss share `int(7 * 0.03) = 0`, jackpot `int(7 * 0.05) = 0`).
- Insurance consumable does NOT trigger on 1 cherry (`payout > 0`), only when `payout == 0`.
- Embed color: `ui.OK` if `net > 0`, `ui.INFO` if `net == 0`, `ui.ERROR` if `net < 0`; upgraded to `ui.GOLD` if `net >= bet * 10`.

## User-Facing Japanese Strings

| Key | Verbatim Text | Source |
|---|---|---|
| `slots.cmd.desc` | `🍒 3つのリール。揃えれば大きく増える` | `cogs/casino/cog.py:80` |
| `slots.title` | `🎰 スロット` | `cogs/casino/simple.py:66` |
| `slots.label.777` | `7️⃣ 大当たり！！` | `domain/games/slot.py:36` |
| `slots.label.triple` | `{symbol} 3つ揃い！` | `domain/games/slot.py:36` |
| `slots.label.cherry2` | `🍒🍒 チェリー2つ` | `domain/games/slot.py:39` |
| `slots.label.cherry1` | `🍒 チェリー（少し戻り）` | `domain/games/slot.py:41` |
| `slots.label.miss` | `ハズレ` | `domain/games/slot.py:42` |
| `slots.result.title` | `{title} — {signed_net}ペリカ` | `cogs/casino/simple.py:69` |
