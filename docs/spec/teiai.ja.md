[English](teiai.md) | **日本語**

# 帝愛銀行、債務、破産猶予、破綻保証、サーモスタット、海外逃亡の仕様

担当：`B3` | 画面 ID：`teiai-bank`、`teiai-bank-cds`、`teiai-bank-debt`（`packages/shared/src/ids.ts`） | 機能トグル：なし（常に有効。`/ペリカ 帝愛`、`/ペリカ 返済`、`/ペリカ 破産`）

> 関連する仕様：帝愛の社債（`docs/spec/stocks.ja.md`）、個人間融資（`docs/spec/p2p-loans.ja.md`）、帝愛共済（`docs/spec/kyosai.ja.md`）。

## 元ファイル
- `catalogs/teiai.yaml:1-112`
- `docs/teiai.md:1-110`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/teiai.py:1-115`
  - `domain/thermostat.py:1-89`
  - `domain/rates.py:1-68`
  - `infra/db/bank.py:1-755`
  - `infra/db/debt.py:1-669`
  - `infra/db/repositories.py:202-276`
  - `services/teiai.py:1-135`
  - `cogs/teiai/panel.py:1-308`
  - `cogs/teiai/escape.py:1-100`
  - `cogs/teiai/texts.py:1-64`
  - `cogs/shared/messages/economy.py:109-142`
  - `cogs/shared/messages/notices.py:10-20,25-30,39-41`

## ルールと正確な数値

### 1. 帝愛の金融（債務、利息、天引き、ピンハネ、種銭の貸付、身分）
- **定数**（`catalogs/teiai.yaml:2-16,34-39,66,97-112`、`domain/teiai.py:19-55,80-101`）：
  - `SEED = 3_000`（種銭の貸付の上限と、ブラックジャックの帝愛の信用でのダブルの上限）
  - `REPAY_RATE = 0.30`（対象となる `income` の 30% を債務の返済に天引きします：`int(income * 0.30)`。優先は帝愛で、残りの枠は延滞中の P2P の貸付に古い順に回します）
  - `SKIM_RATE = 0.20`（債務中のデイリーボーナスから 20% をピンハネ：`int(amount * 0.20)`。帝愛のハウス口座 `teiai_house` に入り、債務は減りません）
  - `LABOR_SKIM_RATE = 0.03`（地下労働のポットの受け取りから 3% のピンハネ。`teiai_house` に入ります。注：`docs/teiai.md:46` は古く、1% と書いています。リマスターは 3% です：`packages/domain/src/progression/economy-core.ts` の `LABOR_SKIM_RATE_BPS = 300`）
  - `HORSE_PRIZE_SKIM_RATE = 0.0`（0%）
  - `DEBT_RATE_PER_DAY = 0.01`（1 日 1% の単利 ＝ トイチ。完了した日数だけ）
  - `DEBT_INTEREST_MAX_DAYS = 10`（1 回の加算を最大 10 日分に頭打ち。超えた経過日数は、`debt_interest_at = now` にリセット）
  - `GRACE_DEBT = 15_000`（債務が `>= 15,000` になると、24 時間の破産猶予が始まる）
  - `DEBT_INTEREST_CEILING = GRACE_DEBT - 1 = 14_999`（利息だけで、ユーザーが猶予に入ることはありません）
  - `GRACE_HOURS = 24`
  - `BANKRUPT_FLOOR = 10_000`（自己破産・強制破産で、債務は最大でも `10,000` に圧縮されます。逃亡に成功すると `0`）
  - `BLACKLIST_DAYS = 7`（破産後、債務が 0 になってから 7 日間、P2P の貸付を借りられない）
  - `SEIZE_RATE = 0.50`（売れないジャンク債、ショップの持ち物、所有する馬の清算率は 50%）
  - `WEALTHY_ASSETS = 1_000_000`（`status == katagi` かつ `net_worth >= 1,000,000` のときの、見た目だけの `🟡 富豪` の表示）
- **身分**（`infra/db/debt.py:294-308`）：
  1. `bankrupt`（`🔴 破産者`）：`bankrupt_at IS NOT NULL AND debt > 0`。
  2. `underground`（`🟤 地下労働者`）：`debt > 0 OR has_overdue_p2p_loan`。
  3. `katagi`（`🟢 カタギ`）：それ以外（`net_worth >= 1,000,000` なら `🟡 富豪` と表示）。
  - リマスターでの接続：`🟡` 富豪バッジは金融純資産（`NetWorthService`）から表示専用で接続されており、`/pelica balance`、`/pelica bank`、`/pelica ranking`（週間・純資産・流動資産）、ライブボード、およびアクティビティの銀行・プロフィール・ランキング画面に表示されます（`katagi_only` 判定は元の身分のままで、ニックネーム接尾辞は使用しません）。
  - `underground` か `bankrupt` の間は、ショップの称号、カードのスキン、演出、コレクションが凍結されます（失われず、`katagi` に戻ると復元されます）。
- **債務の利息の加算**（`infra/db/debt.py:336-375`）：
  - `debt <= 0` なら：`debt_interest_at = 0` にリセットします。
  - `debt_interest_at == 0` なら：`debt_interest_at = now` で初期化します（初期化のときは、利息 0）。
  - `days = int(max(0.0, now - since) // 86400)`。`days <= 0` なら `0` を返します。
  - `counted = min(days, 10)`、`add = max(0, min(int(debt * 0.01 * counted), 14_999 - debt))`。
  - `new_since = now if days > counted else since + days * 86400.0`。
- **強制執行の順番（`owe_for`）**（`infra/db/debt.py:425-430,487-503`、`infra/db/repositories.py:254-263`）：
  1. 現金（`users.balance`）
  2. 帝愛信託の預金（`DepositSeizureStep`。銀行の凍結や、使える現金の上限は無視）
  3. 会社の資金（`CompanySeizureStep`。施設には手をつけません）
  4. 信用取引のポジション（`MarginSeizureStep`）
  5. 現物の保有（`CryptoSeizureStep`、`taxable=False`）
  6. 進行中のオプション（`OptionSeizureStep`）
  7. 売れる通常債（`BondSeizureStep`）
  8. 自分への CDS の補填（`cds_cover_self_for`。古い進行中の自分への CDS から順に、契約ごとに 1 回だけ。現金はユーザーに渡しません）
  9. 残りの `need > 0` を `users.debt` に足します。`cash == 0` なら `SEED = 3,000` を自動で貸し、`grace_update_for` を実行します。
- **種銭の貸付**（`infra/db/debt.py:432-485`）：
  - 手動（`/ペリカ 帝愛` のボタン `種銭を借りる`）：`bankrupt`、猶予中、`balance >= 3,000` のときはブロックされます。`3,000 - balance` を貸します（`debt` に足され、公開で告知されます）。
  - 債務ができたときの自動（`_seed_if_empty_for`）：`debt > 0 and balance == 0` なら `3,000` を貸します。
  - デイリーの受け取りでの自動（`topup_seed_for`）：`debt > 0 and balance < 3,000` なら `3,000 - balance` を貸します。
  - ブラックジャックの信用でのダブル（`can_borrow_for_bet`）：`3,000` まで。`bankrupt` か猶予中はブロックされます。
- **自発的な返済**（`/ペリカ 返済`、`infra/db/debt.py:508-529`）：
  - 金額を省略すると `min(debt, balance)` を返します。`after_debt_change` を呼びます（`< 15,000` になれば猶予を抜けます。破産したユーザーの `debt == 0` で、7 日間のブラックリストのタイマーが始まります）。

### 2. 破産と海外逃亡（海外逃亡）
- **破産の手順（`bankrupt_for`）**（`infra/db/debt.py:600-666`、`infra/db/repositories.py:264-276`）：
  - すでに `bankrupt`、または（`debt <= 0` で、進行中・延滞中の P2P の貸付もない）ときはブロックされます。
  - 1. `bankrupt_prep_hook`：進行中の P2P の出品と入札をすべて引き戻し、進行中の共済のオークションの入札も引き戻します（返金された現金は、清算のプールに入ります）。
  - 2. `liquidation_step`：信用取引 → 現物（`taxable=False`）→ 債券（通常債は DCF で取り消し、ジャンク債は 50% で償却）→ オプション → 帝愛信託の預金 → 会社を解散（資金は現金に戻り、持分は消滅）→ 共済の口を `HOUSE` に回収（評価額 0）。
  - 3. 現金を `pool` に差し押さえます。
  - 4. ショップの持ち物と所有する馬を差し押さえます（帝愛の押収オークションへ。`int(purchase_value * 0.50)` を `pool` に足します）。
  - 5. 順番どおりの配分：優先の帝愛の債務を先に払い → 後順位の P2P の貸付を古い順に払い（残りが 0 なら `repaid`、そうでなければ `discharged`）→ 余りはユーザーに返します（`破産の整理のあまり`）。
  - 6. 帝愛の債務を `<= 10,000`（`escape=True` なら `0`）に圧縮します。`bankrupt_at = now`、`blacklist_until = NULL`。
  - 7. `after_debt_change`、`_seed_if_empty_for`（注：`escape=True` なら `debt == 0` なので、種銭の貸付はありません）、`grace_until` のクリア。
  - 8. CDS の精算：`payable = forced or in_grace`。`payable` なら `cds_settle_default_for(..., debt_before, now)` を実行し、そうでなければ `cds_void_for` です。
  - **ドキュメントとコードのニュアンスの違い**：`docs/teiai.md:35` は、逃亡すると CDS が無効になると書いていますが、`infra/db/debt.py:650` は `payable = forced or in_grace` を確認します。つまり、すでに猶予中に逃亡すると、第三者の CDS は精算され、猶予に入る前に逃亡すると、無効になります。
- **海外逃亡（`escape_attempt`）**（`catalogs/teiai.yaml:10-15`、`infra/db/debt.py:547-598`、`cogs/teiai/escape.py:45-100`）：
  - 条件：`bankrupt` でない、`debt >= 5,000`、`escape_tries < 2`（サーバーごとの生涯の上限）、前回の試行から `24h` のクールダウン。
  - 確認のモーダルのあと、結果をすぐに抽選し（`ESCAPE_CHANCE = 0.01`、1%）、続いて 6 フレームの ASCII の船のアニメーションを流します（1 フレーム `1.4s`、合計 `8.4s`）。
  - 成功（1%）：`bankrupt_for(..., escape=True)` を呼びます → すべての資産を差し押さえ、貸付は免除され、`debt = 0`、7 日間の貸付のブラックリスト。
  - 失敗（99%）：罰金 `max(1_000, int(debt * 0.10))` を `debt` に足し（これでユーザーが破産猶予に入ることもあります）、24 時間のクールダウンを始めます。

### 3. 帝愛銀行（部分準備の信託、取り付け騒ぎ、支払いの順番、CIR の `r_f`、ハウス口座）
- **定数**（`catalogs/teiai.yaml:41-57`、`domain/teiai.py:58-71`）：
  - `BANK_MIN_DEPOSIT = 100`（`katagi` のみ）。
  - `RESERVE_RATIO = 0.20`（預け入れのとき、20% → `cash`、80% → `loaned`（地下の貸付））。
  - `LOAN_RECOVERY_PER_HOUR = 0.02`（`moved = loaned * (1 - 0.98^hours)` が、同期のたびに連続的に `cash` に戻ります）。
  - `LOCK_DEBT_RATE = 0.05`（すべての債務者の債務の 5% を、引当金としてロック）。
  - `TRUST_PREMIUM_PER_DAY = 0.001`（既定は `r_f` の上に +0.1%/日。共済の動議で変更できます）。
  - `RUN_WARN_RATIO = 0.15`（`🟡`）、`RUN_DANGER_RATIO = 0.05`（`🔴`）、`liabilities > 0` で `available <= 0` なら `frozen`（`🚨 支払停止`）。
  - `RF_MIN_PCT = 1.5`、`RF_MAX_PCT = 8.0`、`RF_ALPHA = 4.25`、`RF_KAPPA_PER_DAY = 2.0`、`RF_SIGMA = 0.02`。
- **使える現金と準備率 `θ`**（`infra/db/bank.py:166-190`）：
  - `locks = sum(0.05 * u.debt) + sum(min(third_party_cds_claims, 0.50 * u.debt) for u in grace)`
  - `available = cash - locks`
  - `liabilities = total_trust_deposits + total_active_bond_principal`
  - `θ = available / liabilities`（`liabilities == 0` なら `None`）。
  - 引き出しは `int(available)` で頭打ちで、早い者勝ちです（取り付け騒ぎの仕組み）。
- **帝愛信託の 1 時間ごとの利息（`bank_trust_accrue`）**（`infra/db/bank.py:442-483`）：
  - `trust_ts` からの経過が `>= 1h` になったら実行します（最初の呼び出しは `trust_ts = now` の初期化）。
  - 利率 `r_trust = r_f + trust_premium`（日ごとの連続複利）。
  - `due = total_deposits * expm1(r_trust * hours / 24) + trust_accrued`。
  - `_outflow_for(..., int(due), use_trust=False, thermo=True)` で支払います（現金 → サーモスタット／共済。信託の利息を払うために、信託を削ることは**ありません**）。
  - `paid * amt // total` で按分して、預金者の現金の残高に直接入金します（`income=gain`）。割り振れなかった端数は現金に戻り、`trust_accrued` に持ち越します。
- **銀行の支払いの順番（`_outflow_for` / `bank_pay_batch_for`）**（`infra/db/bank.py:313-401`）：
  1. 銀行の `cash`（`cash_pay = min(amount, max(cash, 0))`）。
  2. **帝愛信託の削減（第一損失）**（`use_trust=True`）：`min(ceil(shortfall - 1e-9), total_deposits)` を取り、すべての預金者の残高に `int(amt * (1 - take / total))` をかけて減らします。信託はマイナスにはなりません。
  3. **超過損失**：`excess = max(0, shortfall - trust_take)`。
     - サーモスタットが `shock = max(0, -net - trust_take)` を吸収し、`bailout` を返します（`enforce=False` の間は `0`）。
     - 残りの `left = int(excess - cover)` は、`charge_excess_for` で共済の保有者に負担させます。支払われなかった HOUSE の分は `excess_unpaid` に記録します。
- **毎日の発掘品の競りからの銀行収入**（リマスター、上流 736efad。`docs/spec/player-market.ja.md` §5）：帝愛は、ギルドごとに UTC の1日に1回、発掘品を1つ、プレイヤーマーケットに出します。落札額は戻らない流出（シンク）で、その全額を `teiai.bankIncome(price)`（サーモスタットあり）で銀行に入れます。プレイヤーマーケットの手数料 5% を入れるのと同じ呼び出しです。売り手への支払いも手数料もなく、売れ残った発掘品は何も渡さず、帝愛からの購入は 24 時間 100,000 の2者間の上限に数えません。この経路でペリカが銀行に入るのは、プレイヤーが払ったときだけです。
- **帝愛のハウス口座（`teiai_house`）**（`infra/db/bank.py:235-293`）：
  - 銀行の準備金（`teiai_bank`）とは別です。
  - デイリーと地下労働のピンハネ（`house_income_for`、`skimmed` が増える）と、会社の建設費・維持費（`house_receive_for`）を受け取ります。
  - 会社の出荷の買い取り（`house_pay_for`）にまず使い、足りなければ、1 日 `30,000` の買取枠（`grant_day`、`grant_used`）に切り替えます。

### 4. 前線のサーモスタット（`domain/thermostat.py`）
- **定数**（`catalogs/teiai.yaml:69-74`）：`ENFORCE = False`（旧版では、観測だけのモード）、`COOL_DAYS = 7`（`λ_L = ln(10)/7`）、`memory_ratio = 4`（`λ_E = λ_L / 4`、28 日）、`E_MIN = 20_000.0`、`COUPLING = 1.0`。
- **`days` にわたる正確な減衰**：
  - `fall_l = exp(-λ_L * days)`、`fall_e = exp(-λ_E * days)`
  - `E' = max(E_MIN, E_MIN + (E - E_MIN) * fall_e + L * (fall_e - fall_l))`
  - `L' = L * fall_l`
- **分割しても変わらない吸収**：
  - `compute_net(amount, load, cap) = (max(cap - c*load, 0) / c) * (-expm1(-c * amount / cap))`
  - `absorb_inflow(state, gain)`：`fill = min(gain, max(-L, 0))` はそのまま通し、`gain - fill` を `compute_net` に通します → `(state', net, burn)`。
  - `absorb_shock(state, loss)`：`covered = min(loss, max(L, 0))` はそのまま通し、`loss - covered` を `compute_net` に通します → `(state', effective, bailout)`。
  - `ENFORCE = False` の間：銀行の現金は変えずに、表示のために `thermo_load`、`thermo_capacity`、`thermo_burned`、`thermo_bailed` を記録します。

### 5. 破綻保証（CDS）
- **定数**（`catalogs/teiai.yaml:59-64`、`domain/teiai.py:74-78,103-108`）：
  - `CDS_MIN_STAKE = 100`、`CDS_MIN_ODDS = 1.2`、`CDS_MAX_ODDS = 15.0`、`CDS_TERM_DAYS = 14`。
  - `CDS_SELF_CAP = 50_000`（進行中の自分への CDS の、配当の見込みの合計 `SUM(stake * odds)` の上限）。
  - `CDS_PAYOUT_CAP_RATE = 0.50`（債務不履行のとき、第三者の CDS の配当の合計を `50% * debt_before` で頭打ちにし、按分で縮めます）。
- **オッズの式**（`domain/teiai.py:103-108`）：
  - `status == "katagi"` なら `r = 0.04`、そうでなければ `0.25 + 0.5 * min(1.0, debt / 15_000)`。
  - `margin_ratio is not None and margin_ratio < 1.5` なら：`r += 0.1`。
  - `odds = round(min(15.0, max(1.2, 0.85 / r)), 1)`。
  - 例：きれいな `katagi` → `0.85 / 0.04 = 21.25` → `15.0x` に頭打ち。`margin_ratio < 1.5` の `katagi` → `0.85 / 0.14 = 6.1x`。`debt = 15,000` の `underground` → `0.85 / 0.75 = 1.13` → `1.2x` に切り上げ。
- **制限**：すでに猶予中（`cds_target_in_grace`）、すでに `bankrupt`（`cds_target_bankrupt`）、または未登録のユーザーには、CDS を買えません。賭け金は、そのまま帝愛銀行に入ります（`bank_income_for`）。
- **配当の公開範囲**：自分への CDS の購入はエフェメラルです。第三者への CDS の購入は**公開**です（`💀 {buyer} が、<@{target}> の破産に賭けた`）。

## タイマーとスケジュール
- **1 分の経済・銀行ループ**：`grace_expire`（`expires` を過ぎた CDS を期限切れにし、`grace_until <= now` の強制破産を実行）、`bank_rf_tick`（`r_f` の CIR の 1 ステップ）、`bank_trust_accrue`（経過が `>= 1h` になったら、1 時間ごとに支払い）。
- **2 分のニックネームの同期**：ニックネームに `【地下労働者】`、`【破産者】`、`【富豪】` を付けます。
- **UI のタイムアウト**：`TeiaiPanel` ＝ `300s`、`TargetView` ＝ `120s`、`ConfirmView` ＝ `30s`。

## 状態機械
- **プレイヤーの債務と身分**：`katagi` → `underground`（`debt > 0` または延滞中の貸付）→ `grace`（`debt >= 15,000`、24 時間のタイマー）→ `bankrupt`（自己破産または強制破産。`debt <= 10,000`、`bankrupt_at` を設定）→ `debt == 0`（身分は `katagi`／`underground` に戻り、7 日間の `blacklist_until` が始まる）。
- **銀行の流動性のレベル**：`safe`（`θ >= 0.15` または `None`）↔ `warn`（`0.05 <= θ < 0.15`）↔ `danger`（`0 < θ < 0.05`）↔ `frozen`（`available <= 0` かつ `liabilities > 0`）。
- **CDS の契約**：`active` → `paid`（自分で補填、または対象が強制破産・猶予中に債務不履行になった）| `void`（対象が猶予の前に自己破産した）| `expired`（`now >= expires`）。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `teiai.panel_title` | `🏦 帝愛銀行` | `cogs/teiai/panel.py:77` |
| `teiai.house_field` | `🕴️ 帝愛の胴元の口座` | `cogs/teiai/panel.py:79` |
| `teiai.thermo_title` | `🌡️ サーモスタット` | `cogs/teiai/texts.py:62` |
| `teiai.thermo_obs` | `（いまは観測だけ。銀行の現金には、まだ反映していません）` | `cogs/teiai/texts.py:63` |
| `teiai.level_safe` | `🟢 余裕あり` | `cogs/teiai/texts.py:49,56` |
| `teiai.level_warn` | `🟡 取り付け警戒` | `cogs/teiai/texts.py:50,57` |
| `teiai.level_danger` | `🔴 取り付け危険水域！` | `cogs/teiai/texts.py:51,58` |
| `teiai.level_frozen` | `🚨 支払停止（信託の解約停止）` | `cogs/teiai/texts.py:52,59` |
| `teiai.btn_deposit` | `信託に入れる` | `cogs/teiai/panel.py:226` |
| `teiai.btn_withdraw` | `信託から引き出す` | `cogs/teiai/panel.py:232` |
| `teiai.btn_cds` | `CDS を掛ける` | `cogs/teiai/panel.py:254` |
| `teiai.btn_seed` | `種銭を借りる` | `cogs/teiai/panel.py:267` |
| `teiai.btn_escape` | `🚢 海外逃亡チャンス！！` | `cogs/teiai/panel.py:281` |
| `teiai.cds_public_title` | `💀 {buyer} が、<@{target}> の破産に賭けた` | `cogs/teiai/panel.py:178` |
| `teiai.seed_public_title` | `💸 {name} が帝愛から種銭を借りました` | `cogs/teiai/panel.py:273` |
| `teiai.escape_confirm` | `海外逃亡を試しますか？` / ボタン `逃亡する！` | `cogs/teiai/escape.py:55,63` |
| `teiai.escape_ok` | `🎉 {name} の海外逃亡、成功！！` | `cogs/teiai/escape.py:88` |
| `teiai.escape_fail` | `🚨 {name} の海外逃亡、失敗…` | `cogs/teiai/escape.py:95` |
| `teiai.err_frozen` | `🚨 帝愛は支払停止中です（信託の解約停止）。手元の現金が、引当金のロックで尽きています。` | `cogs/shared/messages/economy.py:113` |
| `teiai.err_katagi` | `帝愛信託に入れられるのは、🟢 カタギだけです（借金か延滞がある人、破産者は入れられません）。` | `cogs/shared/messages/economy.py:109` |
| `teiai.err_cds_grace` | `その人は、すでに破産猶予に入っているので、掛けられません。` | `cogs/shared/messages/economy.py:118` |
| `teiai.err_cds_self_cap` | `自分への CDS は、配当の見込みの合計が {cap:,}ペリカ までです（いま {have:,}ペリカ分。あと掛けられるのは {room:,}ペリカ）。` | `cogs/shared/messages/economy.py:121-122` |
| `teiai.notice_grace_in` | `⚠️ 借金が {grace_debt:,}ペリカ に達し、**破産猶予**に入りました。<t:{until}:R> までに借金を {grace_debt:,}ペリカ 未満へ戻せなければ、強制破産です。` | `cogs/shared/messages/notices.py:11-12` |
| `teiai.notice_grace_out` | `😮‍💨 借金が減り、破産猶予から抜けました。` | `cogs/shared/messages/notices.py:14` |
| `teiai.ledger_deposit` | `帝愛への預金` | `infra/db/bank.py:515` |
| `teiai.ledger_withdraw` | `帝愛からの引き出し` | `infra/db/bank.py:547` |
| `teiai.ledger_trust_int` | `帝愛信託:利息` | `infra/db/bank.py:472` |
| `teiai.ledger_repay` | `帝愛への返済` / `帝愛への返済（収入から天引き）` | `infra/db/debt.py:403,527` |
| `teiai.ledger_seed` | `帝愛の種銭貸付` | `infra/db/debt.py:434` |
| `teiai.ledger_interest` | `帝愛の利息（トイチ・日利{rate:.0%}・{days}日分）+{add:,}` | `infra/db/debt.py:372` |

## 持ち込まないもの

- **リマスターでは未実装：** 2 分ごとのニックネーム接尾辞の同期（`【地下労働者】`、`【破産者】`、`【富豪】`、ニックネームの管理権限）と、破産時の名前の色ロール解除（ロールの管理権限）は移植していません。🟢🟤🔴🟡 の身分表示は残高カード・アクティビティのプロフィール・ランキングに出ます。
