**English** | [日本語](glossary.ja.md)

# Glossary (EN / JA)

Canonical English and Japanese terms used across the legacy bot, YAML catalogs, behaviour specs, and `packages/shared`. One term per line.

## Core Economy & Accounts

- **Pelica / ペリカ**: In-bot virtual currency (integer, floor `0`, symbol `P`).
- **Initial Grant / 初期残高**: Starting balance of `3,000` Pelica granted once per `(guild_id, user_id)` account.
- **Per-Guild Economy / サーバー別経済**: Strict isolation of balances, debt, inventory, horses, companies, and markets by `guild_id`.
- **Ledger / 取引履歴**: Append-only balance-change log recording `delta`, `balance_after`, `reason`, and timestamp.
- **Escrow / エスクロー**: Temporary wager hold placed before a game resolves, refunded on cancel or settled on completion.
- **Net Assets / 純資産**: Total assets minus liabilities on the balance sheet below; the default ranking key (it used to be mislabelled `総資産` here).
- **Daily Bonus / デイリー**: Claimable reward resetting every 6 hours JST (4 slots/day) with consecutive-claim streak scaling.
- **Streak Guard / ストリーク保護**: Consumable item that preserves a daily streak when a slot is missed.
- **Daily Double / デイリー2倍**: Consumable item that doubles the next daily bonus payout.
- **Transfer / 送金**: Player-to-player Pelica transfer with a `10%` ceiling fee, `20,000` daily principal cap, and `3`-game minimum.
- **Weekly Champion / 週間王者**: Title and reward granted to the top qualified weekly player (`min_plays = 5`).
- **Mission / デイリーミッション**: Daily seeded gameplay objective awarding Pelica upon completion.

## Assets (balance sheet)

`/pelica ranking` (views `net` and `liquid`), `/pelica balance`, the live board and the breakdown
count wealth as a balance sheet (B/S). Lines and groups: `LIQUID_KEYS`, `FIXED_KEYS`,
`LIABILITY_KEYS` in `packages/domain/src/progression/economy-core.ts`; labels are the `bs.*` keys in
`packages/shared/i18n`. Rules and numbers: [economy-core.md §3](economy-core.md#3-balance-sheet-net-assets-純資産-current-assets-流動資産-total-assets-総資産).

- **Current Assets / 流動資産**: Assets that turn into Pelica quickly: cash, deposit (Teiai trust), stocks (spot at market value + margin valuation), bonds (principal), options (valuation), receivable (labor earnings not yet collected), held deposits (auction bids), loans receivable (lent to members). The second ranking view.
- **Fixed Assets / 固定資産**: Assets held and not turned into Pelica right away: belongings (purchase price), relics (reference value), racehorses (purchase price + expected retirement value), company (funds + office build cost), labor tools and dorm (upgrades paid so far).
- **Total Assets / 総資産**: Current assets + fixed assets, before liabilities.
- **Liabilities / 負債**: Borrowings: debt to Teiai (accrued interest included) and borrowings from members.
- **Net Assets / 純資産**: Total assets − liabilities. The default net-worth ranking, the board and the balance-card rank. `current + fixed − liabilities = net` always holds.
- **Financial Net Worth / 金融純資産**: Cash − Teiai debt + deposit, stocks, bonds and options at value. Used only for the 🟡 Wealthy badge; fixed assets and member-to-member loans are left out.
- **Final Total Assets / ファイナル総資産**: Retired legacy term; it is now Net Assets.

## Player Statuses & Ranks

- **Katagi / カタギ**: Standard debt-free player status.
- **Underground Laborer / 地下労働者**: Status assigned while holding active Teiai Bank debt (`debt > 0`).
- **Bankruptcy Grace / 破産猶予**: Warning period triggered when Teiai debt reaches `15,000` Pelica, preceding forced bankruptcy.
- **Bankrupt / 破産者**: Status after voluntary or forced bankruptcy; triggers asset seizure, debt compression, and loan blacklist.
- **Wealthy / 富豪**: Display-only badge for a Katagi player whose financial net worth (金融純資産) is at least `1,000,000`.

## Casino Games

- **Chinchiro / チンチロ**: Three-dice Japanese gambling game against a dealer with up to 3 rolls per turn.
- **Pinzoro / ピンゾロ**: Triple ones `(1, 1, 1)`, highest Chinchiro hand (`5x` payout).
- **Arashi / アラシ**: Triple matching dice `(2,2,2)`–`(6,6,6)`, second-highest Chinchiro hand (`3x` payout).
- **Shigoro / シゴロ**: Straight `(4, 5, 6)`, automatic Chinchiro win (`2x` payout).
- **Me / 目**: Pair plus point die `(a, a, p)` scored by `p` (`1`–`6`, `1x` payout).
- **Menashi / 目なし**: No matching dice after 3 rolls; loses to any scored hand.
- **Hifumi / ヒフミ**: Straight `(1, 2, 3)`, automatic Chinchiro loss (`-2x` penalty).
- **Table pot / 総取り**: The Chinchiro table (`/カジノ チンチロ卓`, 2–6 players): every seat rolls, the strongest hand takes the losers' stakes minus the `10%` table fee (場代); ties split, all equal returns every bet. No `hifumi` double payment at the table.
- **Pachinko / パチンコ**: Multi-spin set machine with omen/tier hit probabilities, round multipliers, and payout sets.
- **Omen / 予兆**: Visual pre-spin tier indicator correlated with Pachinko hit probability.
- **Slots / スロット**: Three-reel slot machine with weighted symbol draws and fixed line multipliers.
- **Blackjack / ブラックジャック**: Standard 21 card game against a dealer supporting hit, stand, and double down.
- **Roulette / ルーレット**: European single-zero (`0`–`36`) wheel supporting red/black, even/odd, low/high, dozens, and straight number bets.
- **Jackpot / ジャックポット**: Progressive guild pool funded by a fraction of lost wagers and randomly awarded on qualifying bets.
- **RTP Level / 設定**: Per-guild, per-game payout tuning level (`1`–`6`) scaling net wins around base theoretical RTP.
- **Bonus Event / ボーナスイベント**: Scheduled or admin-triggered time window boosting net game winnings (`+50%` default).

## Horse Racing & Arena

- **Horse Racing / 競馬**: Scheduled (4 races/day JST) and special 8-runner races with player-owned and NPC horses.
- **Horse Voucher / 馬券引換券**: Shop item (`30,000` Pelica) consumed to register a new player-owned horse.
- **Carrot / にんじん**: Stat reallocation item moving points between `speed`, `stamina`, `power`, and `guts`.
- **Golden Carrot / 黄金のにんじん**: Stat-boost item permanently adding points to two chosen horse stats.
- **Running Style / 脚質**: Pace profile (`逃げ`, `先行`, `差し`, `追込`) governing mid-race vs sprint velocity curves.
- **Win / 単勝**: Bet on the 1st-place horse.
- **Place / 複勝**: Bet on a horse finishing in the top 3.
- **Quinella / 馬連**: Unordered bet on the top 2 horses.
- **Exacta / 馬単**: Ordered bet on 1st and 2nd place.
- **Wide / ワイド**: Unordered bet on any two horses finishing in the top 3.
- **Trio / 三連複**: Unordered bet on the top 3 horses.
- **Trifecta / 三連単**: Ordered bet on 1st, 2nd, and 3rd place.
- **Retirement / 引退**: Permanently retiring a horse for a career-based Pelica payout.
- **Arena / 闘技場**: Daily NPC bracket tournaments (`duel` and `royale`) with spectator betting, weapon bonuses, and subsidized pools.

## Underground Labor, Relics & Minigames

- **Underground Labor / 地下労働**: Clicker + idle worker mining economy with pickaxe/glove/dorm upgrades, fatigue, and terrain bonuses.
- **Fatigue / 疲労**: Resource accumulated on manual clicks that lowers click pay until recovered over time or via energy drinks.
- **Apprentice / 見習い**: Entry-level idle labor worker.
- **Miner / 坑夫**: Mid-tier idle labor worker.
- **Craftsman / 熟練工**: High-output idle labor worker.
- **Foreman / 現場監督**: Idle worker providing luck bonuses to ore and relic drop rolls.
- **Relic / 発掘品**: Rare excavation drop (`relic_fossil`, `relic_bone`, `relic_meteor`, `relic_vase`, `relic_crown`, `relic_tear`) granting passive buffs.
- **Relic Merge / 合成**: Combining `10` identical relics into the next star tier (`★1`–`★5`) to amplify its buff.
- **Quiz / クイズ**: User-authored multiple-choice trivia awarding solvers and authors based on accuracy and participant count.
- **Lottery / 抽選会 (Raffle)**: Guild ticket pool where all entries buy in at a fixed fee and one random winner claims the pot.
- **Poll / 投票**: Timed yes/no guild poll with paid hidden vote rigging (`500` Pelica per adjustment to Teiai Bank).

## Shop & Player Market

- **Shop / ショップ**: Official catalog of titles, consumables, vouchers, skins, and timed-stock items.
- **Teiai Seized Auction / 帝愛押収オークション**: Discounted resale of items and horses seized from bankrupt players, decaying in price over time.
- **Teiai Black Market / 帝愛闇市**: Daily randomized rotating catalog of discounted items and mystery boxes (`reveal`).
- **Player Market / プレイヤーマーケット (P2P Market)**: Player-to-player fixed-price and timed-auction marketplace with a `5%` fee and anti-snipe extensions.

## Securities, Crypto & Derivatives

- **Securities Exchange / 証券取引所**: Four-ticker correlated market (`cs`, `tb`, `gold`, `tech`) ticking every 1 minute with ±30% daily limits.
- **CS Token / CSトークン (`cs`)**: High-volatility crypto ticker consolidated into `/証券` and backed by `CryptoRepo` milli-unit spot holdings.
- **Daily Price Limit / 値幅制限 (ストップ高・ストップ安)**: ±30% cap from daily reference price, setting pin locks (`+1` / `-1`) that restrict one side of trading.
- **Capital Gains Tax / 譲渡益課税**: Progressive tax brackets levied on realized spot and margin profits.
- **Cross Margin / 信用取引**: Leveraged long and short positions with shared collateral, daily financing interest (`0.1%` long / `0.05%` short), and automatic loss-cut.
- **Collateral Headroom / 担保余裕度**: Effective margin ÷ required margin for the whole margin account (shown as 🟢 ≥ `150%`, 🟡 `130–150%`, 🔴 < `130%`). New positions need `130%` or more; below `100%` the loss-cut closes the biggest losers first. Formerly called `維持率`.
- **Option / オプション**: European call and put contracts priced via Black-Scholes with event and earnings jump variance.
- **Pair Warrant / ペア・ワラント**: Relative-performance option between two tickers priced via the Margrabe exchange formula.
- **Earnings Release / 決算**: Scheduled jump shock event on a ticker accompanied by a noisy insider memo (`70%` directional accuracy).
- **Market Event / 市場イベント**: Announced temporary volatility multiplier window on a specific ticker.
- **Bond / 債券**: Fixed-term Teiai or junk debt instruments priced off the CIR risk-free rate (`r_f`), supporting DCF early resale and junk default hazard.

## Teiai Bank, Loans, Kyosai & Companies

- **Teiai Bank / 帝愛銀行**: Guild central bank holding fractional reserves, lending seed money, collecting skims/fees, and underwriting CDS and bonds.
- **Reserve Ratio / 準備率 (`θ`)**: Ratio of liquid bank cash to liabilities governing bank-run freezes, risk-free rates, and Kyosai gates.
- **Thermostat / サーモスタット**: Split-invariant liquidity shock absorber that buffers bank inflows/outflows with daily load decay.
- **Seed Money / 種銭**: Emergency Teiai loan (`3,000` Pelica) available to zero-balance players without exceeding the borrowing ceiling.
- **Toichi / トイチ**: Teiai debt interest rate: `1%` per day simple interest, so 10% over ten days, which gives the name (`DEBT_RATE_PER_DAY = 0.01`; `debtRatePerDayBps: 100` in the remaster). At most 10 days count per accrual, and interest alone never pushes debt past `14,999` (`DEBT_INTEREST_CEILING`).
- **Teiai Skim / ピンハネ**: Automatic Teiai cut (`20%` on debtor daily claims; `3%` on underground labor earnings).
- **Debt Withholding / 天引き**: Automatic `30%` garnishment on debtor incoming payouts and transfers applied directly to debt repayment.
- **Overseas Escape / 海外逃亡**: High-risk debt-evasion attempt (`1%` full wipe success, `99%` fine added to debt).
- **Teiai Trust / 帝愛信託**: Interest-bearing player deposit account at Teiai Bank accruing hourly yield (`r_f + premium`).
- **CDS / 破綻保証 (Credit Default Swap)**: Insurance/bet contract against a target player's default or bankruptcy, priced from status, debt, and margin ratio (collateral headroom, 担保余裕度).
- **P2P Loan / 個人間融資**: Player-to-player loan contract with daily simple interest, overdue penalty (`max(1.5x, 2%/day)`, `2x` cap), and garnishment behind Teiai.
- **Teiai Kyosai / 帝愛共済**: Guild mutual equity fund issuing 100 auctioned units per cycle with Hamilton-method dividends, `5%` P2P transfer fees, excess-loss charges, and governance motions.
- **Company / 会社**: Player-founded production business (`farm`, `mine`, `factory`, etc.) with deterministic daily market states, continuous output, external investor stakes, dividends, and 3-day unpaid upkeep bankruptcy.
- **Admin Tools / 管理コマンド**: Guild-owner/operator commands for guild approval, RTP tuning, balance adjustments, manual bonus events, and feature toggles.
