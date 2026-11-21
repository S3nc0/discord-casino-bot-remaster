# Horse Breeding Design (`horse`, new feature)

> Status: **approved by the owner on 2026-11-21** (§9). Planned owner: **B2-B** · Game ID: `horse` · Screen ID: `horse` (stable tab) · Feature toggle: `horse` · New ledger reason: `horse_breeding_fee`.
>
> Legacy Python has **no breeding** ([horse.md](horse.md) §1). Nothing here is a parity rule; the numbers below are this design's own. §9 records the owner's decisions; §10 holds ideas left out of v1.

## 1. Player story and fit

1. *I have two horses with good records. I pay a breeding fee and get a foal that takes after both of them, with a little luck mixed in.*
2. *The foal waits two days, then races like any other horse: entry, prizes, bets, retirement at 32 races.*
3. *Over time I build a line, and my stable shows each horse's parents and generation.*

How it fits the existing loop ([horse.md](horse.md)):

| Existing piece | With breeding |
| --- | --- |
| Ownership: `horse_voucher` (30,000) → horse with stats 50/50/50/50, max 3 per owner | Breeding is a second way to get a horse. Same cap of 3; a foal takes a slot from birth. |
| Training: `carrot` (move 5), `gold_carrot` (+10 total, once) | Unchanged. Breeding passes on **total** strength a little; carrots still shape the profile. |
| Races: 4–5 regular races/day JST, 8 runners, 1 horse per owner per race | Unchanged. Foals run once mature. Breeding does not raise how often an owner can race. |
| Bets (horse.md §6.2) and odds | Unchanged. A foal starts at 0 races, so the existing first-run factor applies. |
| Retirement: manual, or automatic at 32 races; value `clamp(…, −20,000, +60,000)` | Unchanged for foals. Retired horses cannot breed (§9 D2). |

## 2. Who can breed

A horse is **eligible** when all of these hold (checked inside the breeding transaction):

| Rule | Value |
| --- | --- |
| Owned by the breeder, active (not retired, not seized, not listed on the player market) | — |
| Races run | `>= BREED_MIN_RACES = 4` (and `< 32`, i.e. not retired) |
| Mature (bred horses only) | `now >= matures_at` |
| Foals sired/borne so far | `< MAX_FOALS_PER_HORSE = 2` |
| Breeding cooldown since its last breeding | `>= BREED_COOLDOWN = 72 h` |

- **Pairing:** own horse × own horse, two different horses. No sexes: any two eligible horses pair. (Sexes would halve the useful pairs in a 3-horse stable and add a column, a UI filter and edge cases for no gain.)
- **Racing is not blocked:** a horse entered in an open race, or on cooldown, can still race. Breeding only touches the breeding fields.
- **Breeder status:** balance `>= BREED_FEE`; Teiai debt must be `0` and not bankrupt (same stance as transfer senders, [transfer.md](transfer.md): debtors cannot send Pelica out on optional spending).
- **Stable:** owner's horse count (incl. active market listings, as today) `< MAX_HORSES = 3`. In practice: two parents + one foal fills the stable; breeding again needs a retirement or a sale.
- **Feature toggle:** `horse` off blocks new breedings; foals already born keep maturing.

**Not in v1: another player's horse as a partner (stud fee).** Decided against for v1 (§9 D1); a possible later design is in §10.

## 3. The foal

### 3.1 Stats (pure domain function, injected `Rng`)

Inputs: parent stats `A`, `B` (each stat a multiple of 5 in `[20, 80]`). All arithmetic integer; all stats stay multiples of 5, like carrots and NPC stats.

1. **Total.** `excess = (sum(A) + sum(B)) / 2 − 200`. `inherit = excess / 2`, truncated **toward 0** to a multiple of 5 (so `inherit ∈ {−5, 0, +5}`). Noise `n` from `{−10, −5, 0, +5, +10}` with weights `1:2:4:2:1`. `T = clamp(200 + inherit + n, 190, 210)`.
2. **Shape.** For each stat `s`: `t[s] = 50 + ((A[s] + B[s]) / 2 − 50) / 2 + rng.int(−7, 8)` (regress halfway to 50, then ±7).
3. **Allocate.** Every stat starts at 20; the remaining `(T − 80) / 5` steps of 5 are split in proportion to `max(1, t[s] − 20)`, largest remainder first (ties in `speed, stamina, power, guts` order). A stat above 80 gives its extra steps to the lowest stat (same tie order).

Why it cannot run away:

- **Hard cap: no horse's stat total may exceed `TOTAL_CAP = 210`**, which is today's maximum (200 + one gold carrot). `gold_carrot` therefore also fails when the new total would pass 210, so it works only on horses at `<= 200`. Voucher and legacy horses are never affected (200 + 10 = 210).
- **Regression to the mean:** half of the parents' excess is passed on, truncated toward 200; the noise is symmetric; the clamp `[190, 210]` cuts the top harder than the bottom when parents are strong.
- Simulation of the rules above (400 horses, 50 generations, seeded RNG): random pairing keeps the mean total at **200.0 ± 0.8**; always breeding the top 10% plateaus at a mean of **≈204.5** (never above 210); single stats stayed in `[35, 70]`. Breeding gives a modest edge in total; specialist profiles still come from carrots.

### 3.2 Everything else about a foal

| Field | Rule |
| --- | --- |
| Name | Required in the breed form; same rules as a voucher horse (horse.md §2.1: 1–12 chars, banned chars, no `http`). |
| Coat | 45% parent A's, 45% parent B's, 10% uniform from `COATS`. |
| Silks | The breeder's choice in the form (default: parent A's); changeable later as today. |
| Style | `None` (auto). |
| Record | `races = wins = places = 0`; carrots and gold carrot usable during maturity. |
| Maturity | `matures_at = foaled_at + FOAL_MATURITY = 48 h` (≈ 9 regular races). Before that: no race entry; trading on the player market is allowed. |
| Generation | `max(gen(A), gen(B)) + 1`; voucher, seized and legacy horses are generation 0. |
| Base value | `base_value = BREED_FEE` (15,000) instead of the voucher's 30,000. Used wherever legacy uses `30,000` per horse: asset valuation `max(0, base_value + retire_value)`, bankruptcy seizure credit and Teiai auction price. Stops "breed for 15,000, count as 30,000". |

Breeding is **instant**: one transaction charges the fee, updates both parents and creates the foal. No gestation state, no scheduler job.

## 4. Economy

| Constant | Value | Flow |
| --- | --- | --- |
| `BREED_FEE` | **15,000** Pelica (half a voucher) | `horse_breeding_fee`, **sink** |
| New faucets | **none** | — |

Sizing against horse.md and the 3,000 start:

- A new player (3,000) cannot breed; a breeder has already paid 60,000 for two vouchers and raced each 4 times. 15,000 ≈ 1¼ regular first-place prizes at the full table (12,000; pool scaling usually pays less, so in practice several wins), or 1–4 days of daily bonuses (1,000–3,000 per claim, 4 claims/day).
- It is cheaper than a voucher (30,000) on purpose, so it is worth doing; it is not free, and it costs a stable slot plus 48 h + 72 h of waiting.

Inflation sanity check (per guild):

1. **The only horse faucet is the retirement payout** (`horse_retirement`, max +60,000 at 32 races). Its rate is bounded by race slots, not by horse count: 1 horse per owner per race × ≈4.5 races/day ⇒ at most one 32-race career per owner per ≈7 days. **Breeding does not change that bound.**
2. **Average horse is a net sink.** At the field average (win 1/8, top-3 3/8), a 32-race career ends at `4×5,000 + 8×2,000 − 20×2,000 = −4,000` (a fee). Entry fees (32 × 1,000) roughly fund the prize pool (prizes scale to `real_entries × 1,000`), so the loop is closed. Per average foal: `−15,000` fee `−4,000` retirement ≈ **−19,000** Pelica leaves circulation.
3. **Worst case:** breeding replaces the 30,000 voucher sink with 15,000, so at most **15,000 less sink per replacement horse**, ≤ 1 replacement per owner per week ⇒ ≤ ≈2,100 Pelica/owner/day, against a daily-bonus faucet of 4,000–12,000 per player per day. Small, and still a sink.
4. **Rankings:** `純資産` (default ranking) does not include horses. `総資産` counts a foal at `base_value` 15,000, the price paid, so breeding cannot inflate it.

## 5. Data

Per-guild, in the existing `horses` table (already `guild_id`-scoped) plus one log table. B1 writes the migration; the legacy importer sets the new columns to their defaults.

| Change | Columns |
| --- | --- |
| `horses` + | `parent_a_id INTEGER NULL REFERENCES horses(id)`, `parent_b_id INTEGER NULL REFERENCES horses(id)`, `generation INTEGER NOT NULL DEFAULT 0`, `foaled_at INTEGER NULL` (epoch ms), `matures_at INTEGER NULL`, `last_bred_at INTEGER NULL`, `foal_count INTEGER NOT NULL DEFAULT 0 CHECK (foal_count BETWEEN 0 AND 2)`, `base_value INTEGER NOT NULL DEFAULT 30000` |
| new `horse_breedings` | `id`, `guild_id`, `user_id`, `parent_a_id`, `parent_b_id`, `foal_id UNIQUE`, `fee`, `created_at`. Audit trail and the ledger `ref_id`. |

Retired and seized parents keep their rows (owner `-2` / `-1`), so lineage still resolves.

**Ledger reasons** (append to `LEDGER_REASONS`, A1 task):

| Reason | Flow | Sign | Ledger label (JA history) |
| --- | --- | --- | --- |
| `horse_breeding_fee` | sink | −1 | `競馬:配合料（{name}）` |

`ref_type = 'horse_breeding'`, `ref_id = horse_breedings.id`.

**Domain event** (append to `DomainEvent` / `DOMAIN_EVENT_TYPES`):

```ts
HorseFoaled = event('HorseFoaled', {
  userId: Snowflake,            // breeder, new owner of the foal
  foalId: Type.Integer({ minimum: 1 }),
  foalName: Type.String({ minLength: 1, maxLength: 12 }),
  parentIds: Type.Tuple([Type.Integer({ minimum: 1 }), Type.Integer({ minimum: 1 })]),
  statTotal: Type.Integer({ minimum: 190, maximum: 210 }),
  generation: Type.Integer({ minimum: 1 }),
  maturesAt: EpochMs,
});
```

Subscribers: breeder's inbox + opt-in DM (new `NotificationKind` `horse_foaled` → `HorseFoaled`); guild announcement only when `statTotal >= 205` (keeps chat quiet). No "matured" event: the stable shows the countdown.

**Intent:** `ActionIntent` with `game: 'horse'`, `action: 'breed'`, `args: { parentA, parentB, name, silks }`. Rejections use existing `ErrorCode`s (`insufficient_funds`, `conflict`, `forbidden`, `invalid_payload`); the specific message key below travels in the game-specific result.

**i18n keys** (examples; `ja` typed against `en`):

| Key | EN | JA |
| --- | --- | --- |
| `horse.breed.title` | Breeding | 配合 |
| `horse.breed.fee` | Breeding fee: {fee} | 配合料: {fee} |
| `horse.breed.confirm` | Breed {a} × {b} for {fee}? The foal's stats are set at birth and can't be redone. | {a} × {b} を {fee} で配合しますか？子馬の能力は生まれたときに決まり、やり直せません。 |
| `horse.breed.born` | 🐣 {name} was born! | 🐣 {name} が生まれました！ |
| `horse.breed.matures` | Can race from {time} | {time} から出走できます |
| `horse.lineage` | Parents: {a} × {b} · Gen {gen} | 両親: {a} × {b}・{gen}代目 |
| `horse.announce.foaled` | 🐣 A promising foal, {name}, was born in {owner}'s stable ({a} × {b}) | 🐣 {owner} さんの厩舎に、期待の子馬 {name} が生まれました（{a} × {b}） |
| `inbox.kind.horse_foaled` | Foal born | 子馬が生まれました |
| `horse.breed.err.cooldown` | {name} can breed again {time}. | {name} は {time} から、また配合できます。 |
| `horse.breed.err.min_races` | {name} needs {min} races before breeding. | {name} は {min} 戦走るまで、配合できません。 |
| `horse.breed.err.foal_limit` | {name} already has {max} foals. | {name} は、もう {max} 頭の子がいます。 |
| `horse.breed.err.stable_full` | Your stable is full ({max} horses). Retire or sell one first. | 厩舎がいっぱいです（{max} 頭まで）。先に引退か売却をしてください。 |
| `horse.breed.err.in_debt` | You can't breed while you owe Teiai. | 帝愛への借金があるあいだは、配合できません。 |
| `horse.breed.err.same_horse` | Pick two different horses. | 違う馬を 2 頭選んでください。 |
| `horse.err.foal_immature` | This foal can race from {time}. | この子馬は {time} から出走できます。 |
| `horse.err.gold_carrot_total_cap` | Total stats can't go above {max}. | 能力の合計は {max} までです。 |

## 6. Edge cases

| Case | Behaviour |
| --- | --- |
| Parent retired during its cooldown | Nothing to do: cooldown lives on the horse row; the foal and its lineage are unaffected. |
| Parent sold or traded during cooldown | `last_bred_at` and `foal_count` travel with the horse, so the buyer inherits the cooldown and the remaining foal allowance (no reset by selling to a friend). |
| Parent listed on the market | Not eligible while listed (owner `-3`); the in-transaction ownership check fails with `conflict`. |
| Bankruptcy (voluntary, forced, escape) | Foals are seized like any horse (owner `-1`), immature ones included; maturity keeps counting. Seizure credit and Teiai auction price use `base_value`. |
| Breeder in debt / in bankruptcy grace / bankrupt | Rejected before any change (`horse.breed.err.in_debt`). Balance never goes negative: fee must be covered by cash. |
| Debt arrives between confirm and commit | The transaction re-reads debt and balance; it either commits fully or changes nothing. |
| Stable at the cap | Rejected before charging (`stable_full`). Market listings count, as today. A won player-market auction still checks the buyer's cap at settlement (player-market.md). |
| Owner leaves the guild | We can't see it (no member intent). Horses stay in place and frozen in practice (no entries without the owner). On return everything is still there. |
| Two breed requests using the same parent (double click, two devices) | Same `idempotencyKey` → stored response replayed. Different keys → SQLite serializes writers; the parent update is conditional (`WHERE last_bred_at IS NULL OR last_bred_at <= now − 72 h AND foal_count < 2`) and must change both rows, else `conflict` and rollback. |
| Breeding while a parent's race settles | No conflict: settlement writes the record and breeding writes the breeding fields. If a parent auto-retires at 32 races first, breeding fails eligibility. |
| Re-roll attempts | Stats are rolled once on the server and stored in the same transaction; a replay returns the stored foal. No preview before paying. Retiring a 0-race foal pays 0. |
| Feature `horse` toggled off | New breedings blocked; foals mature; existing data untouched. |

## 7. Implementation outline (for B2-B)

- Pure `breedFoal({ a, b, name, silks }, ctx)` in the race domain module (`packages/domain/race/`, B2-B): eligibility checks, stats (§3.1), coat; returns `Outcome` with the foal draft and a `HorseFoaled` event draft. Constants in a catalog block next to the horse catalog.
- Server service: one transaction = re-read both horses and the breeder (balance, debt, count), conditional parent update, `EconomyService` debit `horse_breeding_fee`, insert foal + `horse_breedings`, idempotency record; publish `HorseFoaled` after commit.
- Race entry: add the `matures_at` check next to the existing entry checks. `gold_carrot`: add the `TOTAL_CAP` check.
- Shared changes (A1 task first): ledger reason(s), `HorseFoaled`, `horse_foaled` notification kind, i18n keys.

## 8. Test plan

Property tests (seeded RNG, many runs):

- For any two valid parents (stats multiples of 5 in `[20, 80]`, totals in `[190, 210]`): foal stats are multiples of 5 in `[20, 80]`, total in `[190, 210]`, and `<= TOTAL_CAP`.
- **No upward drift:** a 400-horse population with random pairing over 50 generations keeps its mean total within `200 ± 2` and the mean of each stat within `50 ± 2`.
- **Bounded under selection:** always breeding the top 10% by total never yields a total above 210, and the mean stays `<= 206`.
- Same seed and same parents give the same foal (determinism); swapping parents A and B gives the same total distribution.

Unit cases:

- Each eligibility rule rejects on its own: 3 races, cooldown 71 h 59 m, `foal_count = 2`, immature foal as parent, same horse twice, another player's horse, retired, listed, seized.
- Fee: exact 15,000 balance succeeds and ends at 0; 14,999 fails with no rows written; debt `> 0` fails.
- Stable: 3 horses (or 2 + 1 listing) fails; 2 horses succeeds and ends at 3.
- Ledger: one `horse_breeding_fee` row of `−15,000`, `isDeltaAllowed` holds, `ref_id` = breeding id; supply check still balances.
- Idempotency: same key twice → one foal, one ledger row, `replayed: true`. Two keys racing on one parent → exactly one foal.
- Foal: generation, `matures_at = foaled_at + 48 h`, `base_value = 15,000`; race entry rejected at 47 h 59 m and accepted at 48 h.
- Gold carrot on a 205-total foal fails; on a 200-total foal succeeds to 210.
- Bankruptcy seizes an immature foal; valuation and auction price use 15,000.

## 9. Decisions (2026-11-21)

The owner accepted every recommendation:

- **D1 Pairing:** own × own only. No stud fee or cross-owner breeding in v1.
- **D2 Retired horses:** do not breed. Only active horses are eligible.
- **D3 Breeding fee:** `BREED_FEE = 15,000` Pelica (sink).
- **D4 Stable cap:** stays at `MAX_HORSES = 3`, foals included.
- **D5 Total cap:** `TOTAL_CAP = 210` on every horse's stat total; `gold_carrot` fails if it would pass 210.

## 10. Later (not in v1)

**Stud offers (another player's horse as a partner).** If wanted later, the simplest form is a _standing offer_: the stud's owner marks one eligible horse "open to stud" at a fee `STUD_FEE` in `[1,000, 30,000]`; any other player pairs one of their own eligible horses with it at once, paying `BREED_FEE` (sink) + `STUD_FEE` (transfer) in one transaction, so no escrow is needed. The foal goes to the breeder; the stud gets the cooldown and a foal count. Offers lapse after 7 days and are withdrawn when the stud retires, is sold, listed or seized (bankruptcy deletes them).

- Ledger: a transfer reason has one fixed sign, so it needs a pair: `horse_stud_fee` (transfer, −1, `競馬:種付け料（{stud}）`) and `horse_stud_income` (transfer, +1, `競馬:種付け料の受け取り（{stud}）`). Stud income gets the usual 30% `debt_withholding` row.
- Data: `horse_stud_offers (guild_id, horse_id PK with guild, owner_id, fee, created_at, expires_at)`; `horse_breedings` gains `stud_owner_id NULL`, `stud_fee NULL`; `HorseFoaled` gains optional `studOwnerId` for the stud owner's inbox; the breed intent gains `studOfferId`.
- Economy: the transfer rows sum to zero, and moving Pelica to a friend this way costs the 15,000 sink each time, far more than `/送金`'s 10% fee, so it does not get around the transfer limits.
- An approve-each-request flow would instead need an escrow hold/release pair and a pending state; only worth it if owners want to vet partners.
- Tests: stud rows sum to 0; stud income to an indebted owner produces `debt_withholding`; an expired or withdrawn offer → `conflict`.

**Retire to stud** (D2 alternative): a retired horse kept as a breeder with no payout, still counting toward the cap.
