**English** | [日本語](relics.ja.md)

# Relics Specification (`relics`)

> Planned Owner: **B2-B** · Screen ID: `inventory` / `work` (merged inside Underground Labor UI) · Ledger Reasons: none (relies on inventory items, tradeable on `market`)

## 1. Source Files

- `catalogs/relics.yaml` (L1–L25): buff rate, merge count, max star tier, 6 relic buff bindings
- `catalogs/labor.yaml` (L135–L167): 6 relic definitions, drop probabilities, reference values, big-find list
- The original Python bot (see git history before v1.0.0), paths relative to its folder:
  - `domain/relics.py` (L1–L65): ID parsing/formatting, buff aggregation, `chance_round`
  - `infra/db/relics.py` (L1–L70): `RelicRepo` inventory lookup, buff query, merging
  - `domain/shop.py` (relic catalog generation — see `docs/spec/shop.md`)
  - `cogs/labor/views.py` (L124–L143, L235–L240): relic merge UI inside `/地下 作業`
  - `cogs/shared/messages/games.py` (L59–L61): failure messages

---

## 2. Rules & Exact Numbers

### 2.1 Acquisition & Storage
- Relics are discovered passively by underground labor workers (`apprentice`, `miner`, `craftsman`; NOT `foreman`) during idle settlement (`domain/labor.py:234-251`) and transferred to `inventory` when the user presses **受け取る** (`infra/db/labor.py:474-479`).
- They are **not** sold in the regular shop (`shop.py` registers them as `category="relic"` items for inventory, market, and asset valuation only).
- A second source (remaster, upstream 736efad): **Teiai auctions one unstarred relic per guild per UTC day** on the player market (`docs/spec/player-market.md` §5). The relic is drawn by the same dig odds as underground labor (`RELIC_DROPS`: fossil most often, the Dragon's tear rarely), starts at its reference value (`RELIC_VALUE`) and goes to the top bidder for the whole price, which is a sink into Teiai Bank income; unsold, it disappears. It is the only way to get a relic by paying Pelica to Teiai, and it adds about 5,133 of reference value per guild per day.
- Players can trade relics on the P2P player market (`docs/spec/player-market.md`). **Escrowed/listed relics do NOT apply buffs** while listed because they are removed from `inventory`.

### 2.2 Star Tiers & Merging (`catalogs/relics.yaml:2-4`, `domain/relics.py:11-50`, `infra/db/relics.py:47-69`)
- Base buff per unstarred relic: **`BUFF_RATE = 0.01`** (+1%).
- Merge cost: **`MERGE_COUNT = 10`** identical relics (same `item_id` / star level) combine into `1` relic of `star + 1`.
- Max star tier: **`STAR_MAX = 3`** (`★`, `★★`, `★★★`).
- ID convention (`domain/relics.py:18-29`):
  - Star 0: `<base_id>` (e.g. `relic_fossil`)
  - Star `n` (`1..3`): `<base_id>_s<n>` (e.g. `relic_fossil_s1`, `relic_fossil_s2`, `relic_fossil_s3`)
- Effect & reference value scaling per star: `10^star` (`MERGE_COUNT ** star`):
  - ★0: `+1%` (`1×` value)
  - ★1 (`_s1`): `+10%` (`10×` value)
  - ★2 (`_s2`): `+100%` (`100×` value)
  - ★3 (`_s3`): `+1,000%` (`1,000×` value)
- Merging preserves total buff power identically (`10 × +1% = 1 × +10%`) while compacting inventory and raising unit trade value.
- All held relics stack additively with **no upper cap** (`round(sum, 6)`).

### 2.3 Six Relic Types & Integration Points (`catalogs/relics.yaml:6-24`, `catalogs/labor.yaml:135-166`)

| Base Item ID | Name | Icon | Base Value | Buff Key | Applied Where | Exact Formula |
|---|---|---|---|---|---|---|
| `relic_fossil` | `三葉虫の化石` | `🐚` | `1,500` | `click` | `infra/db/labor.py:380` | `max(1, chance_round(base_pay * (1 + buff)))` |
| `relic_bone` | `恐竜の骨` | `🦴` | `4,000` | `wage` | `domain/labor.py:301,318,343` | `idle_rate * (1 + buff) * hours` |
| `relic_meteor` | `隕石の欠片` | `☄️` | `10,000` | `luck` | `domain/labor.py:319` | `luck = foreman_luck + buff` (scales ore & relic drops) |
| `relic_vase` | `古代文明の壺` | `🏺` | `25,000` | `recovery` | `domain/labor.py:58` | `fatigue - dt * 0.1 * (1 + buff)` |
| `relic_crown` | `王家の黄金冠` | `👑` | `60,000` | `daily` | `infra/db/wallet.py` (daily claim) | `round(base_daily * (1 + buff))` |
| `relic_tear` | `竜の涙` | `🔮` | `100,000` | `prize` | `infra/db/race.py:463-465` | `round(prize * (1 + buff))` (before Teiai prize skim) |

### 2.4 Stochastic Rounding (`chance_round`, `domain/relics.py:60-64`)
- Used for `click` buff so small bonuses like `+1%` on a `10`-Pelica click (`10.1`) average accurately:
  `int(x) + (1 if rng.random() < (x - int(x)) else 0)`.

---

## 3. Edge Cases

- Merging is atomic inside a DB transaction: decrements `qty` by `10` where `qty >= 10` and upserts `+1` of `<base>_s<star+1>`.
- `relic_merge` rejects non-relic items (`relic_not_relic`), star `>= 3` (`relic_max_star`), and insufficient un-listed stock (`relic_need_more`).
- Only items in `inventory` matching `item_id LIKE 'relic_%'` with `qty > 0` contribute to buffs (`infra/db/relics.py:21-28`).
- In `LaborView`, the merge dropdown appears only when the user has at least 1 mergeable relic (`qty >= 10` and `star < 3`), sorted by descending reference value, capped at Discord's 25 select options (`cogs/labor/views.py:124-143`).

---

## 4. Verbatim Japanese Strings

| Key ID | Verbatim Japanese String | Source |
|---|---|---|
| `relic.buff.text` | `持っている間、{description}が 1個ごとに +{pct:.0%}` | `domain/relics.py:57` |
| `relic.buff.desc.fossil` | `地下作業の「働く」1回の稼ぎ` | `catalogs/relics.yaml:9` |
| `relic.buff.desc.bone` | `作業員の稼ぎ` | `catalogs/relics.yaml:12` |
| `relic.buff.desc.meteor` | `作業員の鉱石・発掘品の出やすさ` | `catalogs/relics.yaml:15` |
| `relic.buff.desc.vase` | `地下作業の疲労の回復` | `catalogs/relics.yaml:18` |
| `relic.buff.desc.crown` | `デイリーボーナスの額` | `catalogs/relics.yaml:21` |
| `relic.buff.desc.tear` | `競馬の賞金（馬主として受け取る額）` | `catalogs/relics.yaml:24` |
| `relic.ui.merge_placeholder` | `🧬 発掘品を合体（{count}個 → ★が1つ増えた1個）` | `cogs/labor/views.py:131` |
| `relic.ui.merge_option` | `{old_name} {count}個 → {new_name}（いま {held}個）` | `cogs/labor/views.py:135` |
| `relic.ui.merge_ok` | `🧬 合体した！　**{mark}{name}** ができた。{buff_text}` | `cogs/labor/views.py:240` |
| `relic.err.not_relic` | `発掘品ではありません。` | `cogs/shared/messages/games.py:59` |
| `relic.err.max_star` | `★{star_max} は最上位で、これ以上は合体できません。` | `cogs/shared/messages/games.py:60` |
| `relic.err.need_more` | `合体には、同じ発掘品が {count}個 要ります（出品中の品は数えません）。` | `cogs/shared/messages/games.py:61` |
