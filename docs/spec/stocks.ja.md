[English](stocks.md) | **日本語**

# 証券市場（株式、信用取引、オプション、債券、イベント、決算）仕様

担当：`B3` | 画面 ID：`stocks`、`stocks-detail`、`stocks-margin`、`stocks-options`、`stocks-bonds`（`packages/shared/src/ids.ts`） | 機能トグル：`market`（現物／信用取引／オプション／チャート／保有）、`bonds`（`/証券 注文 債券`）

> 注：4 銘柄すべて（既定の `cs` ＝ CSトークンを含む）の現物の保有は、`CryptoRepo` と `crypto` テーブルを共有します。CSトークンの現物台帳、ミリ単位の計算、担保ロック、旧版の `/暗号` → `/証券` への統合の詳細は `docs/spec/crypto.ja.md` を参照してください。

## 元ファイル
- `catalogs/market.yaml:1-158`
- `catalogs/bonds.yaml:1-22`
- `docs/stocks.md:1-157`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/market.py:1-339`
  - `domain/market_events.py:1-128`
  - `domain/earnings.py:1-104`
  - `domain/options.py:1-194`
  - `domain/bonds.py:1-80`
  - `domain/rates.py:1-68`
  - `infra/db/market.py:1-190`
  - `infra/db/market_events.py:1-75`
  - `infra/db/earnings.py:1-95`
  - `infra/db/crypto.py:1-192`
  - `infra/db/margin.py:1-518`
  - `infra/db/options.py:1-355`
  - `infra/db/bonds.py:1-252`
  - `services/market.py:1-285`
  - `cogs/market/cog.py:1-395`
  - `cogs/market/orders.py:1-345`
  - `cogs/market/bond_cog.py:1-66`
  - `cogs/market/embeds.py:1-454`
  - `cogs/market/bond_embeds.py:1-30`
  - `cogs/market/feed.py:1-93`
  - `cogs/market/views.py:1-242`
  - `cogs/shared/messages/market.py:1-107`

## ルールと正確な数値

### 1. 銘柄と、全体の価格エンジン（1 分ティック）
- **範囲**：価格は**全サーバーで共通**です（`market_prices` に `guild_id` はありません）。ポジション、保有、債券、オプションは、厳密に**サーバーごと**です。
- **4 銘柄**（`catalogs/market.yaml:16-40`、`domain/market.py:39-42`）：
  | キー | 名前 | 絵文字 | `start` | `sigma`（1 分） | `drift`（対数／日） | オプションの既定のストライクの OTM |
  |---|---|---|---|---|---|---|
  | `cs` | `CSトークン` | `🪙` | `1000.0` | `0.0012` | `0.008` | `0.03`（3%） |
  | `teio` | `TEIO重工` | `🏭` | `1200.0` | `0.0007` | `0.007` | `0.02`（2%） |
  | `numa` | `NUMAバイオ` | `🧪` | `400.0` | `0.0022` | `0.010` | `0.05`（5%） |
  | `gold` | `GOLD地金` | `🥇` | `3000.0` | `0.0004` | `0.003` | `0.015`（1.5%） |
- **相関行列**（`catalogs/market.yaml:41-53`、対称、対角は `1.0`）：
  - `(cs, teio) = +0.60`、`(cs, numa) = +0.05`、`(teio, numa) = +0.05`
  - `(cs, gold) = -0.60`、`(teio, gold) = -0.50`、`(numa, gold) = -0.10`
- **共分散とコレスキー分解**（`domain/market.py:135-158`）：
  - `Σ[i][j] = σ_i * σ_j * ρ_ij`。順番は `[cs, teio, numa, gold]`。
  - 下三角のコレスキー因子 `L` は `Σ = L L^T` を満たします。
- **1 分ティックの式**（`domain/market.py:54-59,161-186`）：
  - 定数：`MIN_PRICE = 20`、`MAX_PRICE = 50_000`、`KEEP_DAYS = 30`、`DRIFT_BAND = 8.0`、`EVENT_PROB = 1 / 720`（1 日に約 2 回）、`EVENT_RANGE = (0.015, 0.035)`、`EVENT_SCALE_MAX = 1.5`。
  - `z = [rng.gauss(0, 1) for _ in SYMBOLS]` を引き、`shock[i] = Σ_{k<=i} L[i][k] * z[k]`。
  - パニックショック：確率 `1/720` で、`event ∈ {+1, -1}`（50/50）、`size ~ Uniform(0.015, 0.035)`。
    `panic_i = 1 + event * size * min(1.5, σ_i / σ_cs)`。
  - 高値での減衰つきのドリフト：
    - `drift <= 0` または `price <= start`：`d_i = drift / 1440.0`。
    - それ以外：`fade = max(0.0, 1.0 - ln(price / start) / ln(8.0))`、`d_i = drift * fade / 1440.0`。（開始価格の `8` 倍で `0` になります。）
  - ボラティリティイベントの倍率 `m_i = market_events.multiplier(events, sym.key, now)`（イベント中は `2.0`、それ以外は `1.0`）。
  - `factor_i = exp(d_i - m_i^2 * Σ[i][i] / 2 + m_i * shock[i]) * panic_i`
  - `new_fair_i = min(50_000, max(20, round(fair_i * factor_i, 2)))`
- **値幅制限とピンのロック（±30%）**（`domain/market.py:62-95`、`infra/db/market.py`）：
  - `DAILY_LIMIT = 0.30`。基準価格 `ref` ＝ `now - 86_400s`（24 時間前）の価格（なければ制限なし）。
  - 理論価格（`fair_price`）は自由に動き（決算のジャンプも吸収します）、表示・取引される `price = clamp(fair, ref * 0.70, ref * 1.30)` です。
  - ピンの状態：`fair >= ref * 1.30` なら `+1`（`🚀 ストップ高`）、`fair <= ref * 0.70` なら `-1`（`🚨 ストップ安`）、それ以外は `0`。
  - ピン中にブロックされる操作（`catalogs/market.yaml:56-58`）：
    - ピン `-1`（ストップ安）：`sell_spot`、`close_long`、`sell_call` をブロックします。
    - ピン `+1`（ストップ高）：`buy_spot`、`open_long`、`cover_short` をブロックします。
    - 反対側の注文と、利益確定は引き続き可能です。
- **整形とチャート**（`domain/market.py:206-208,263-339`）：
  - `fmt(price)`：`price < 100` なら `f"{price:,.2f}"`、そうでなければ `f"{price:,.0f}"`。
  - `UNIT = 1000`（1 株 ＝ 1,000 ミリ単位の `口`。`f"{units / 1000:,.3f}枚"` で整形）。
  - 期間：`1h`（3600s）、`6h`（21600s）、`24h`（86400s）、`7d`（604800s）。
  - ASCII のブロックのチャート：`width = 32`、`height = 8`、8 段階のブロック `" ▁▂▃▄▅▆▇█"`。ライブチャートは `LIVE_MINUTES = 60` 分のあいだ、1 分ごとに自動で更新されます（`cogs/market/embeds.py:18`）。
  - 相関の表示には、`>= 30` 組の一致するタイムスタンプが必要です（`domain/market.py:271`）。閾値：`>= 0.6`（`🔗 強く連動`）、`>= 0.3`（`↗️ やや連動`）、`> -0.3`（`➖ ほぼ無関係`）、`> -0.6`（`↘️ やや逆に動く`）、`<= -0.6`（`🔀 逆に動く`）。

### 2. 現物取引と累進の譲渡益課税
- `CryptoRepo` の買い・売りの見積もり、ミリ単位の計算、担保の確認のルールの詳細は `docs/spec/crypto.ja.md` を参照してください。
- `FEE_RATE = 0.0`（取引手数料はゼロ）。`CONFIRM_FROM = 5_000`。
- **累進の譲渡益課税**（`catalogs/market.yaml:64-72`、`domain/market.py:99-114`）：
  - **現物の売り**と**信用取引の決済**で、利益が出たとき（`profit > 0`、`taxable=True`。強制破産の清算は `taxable=False`）に、1 回ごとにかかります。
  - 限界税率の区分：
    | 利益の区分（ペリカ） | 税率 |
    |---|---|
    | `0 .. 10,000` | `0%` |
    | `10,001 .. 100,000` | `3%` |
    | `100,001 .. 1,000,000` | `7%` |
    | `1,000,001+` | `12%` |
  - 結果は `int(tax)` で切り捨てます。税収は帝愛銀行の収入になります（`house_income_for`）。

### 3. クロスマージン取引（買いと売り）
- **定数**（`catalogs/market.yaml:62-63,73-83`、`domain/market.py:25-26,117-125,190-204`）：
  - 使えるレバレッジ：`SHORT_LEVERAGES = (1, 2, 3, 5)`。
  - `SHORT_MIN_MARGIN = 10` ペリカ。
  - `RISK_K = 20.0`（ポートフォリオの証拠金の係数）。
  - `OPEN_RATIO = 1.30`（信用取引を建てる・追加する、または担保を売る・取り消すのに必要な、最低 130% の維持率）。
  - `LOSSCUT_RATIO = 1.00`（100% で強制決済が発動）。
  - 担保の掛け目（`COLLATERAL_HAIRCUT`）：`spot = 0.80`、`normal` の債券 ＝ `0.95`、`junk` の債券 ＝ `0.50`。
  - 信用取引の金利（`BORROW_RATE_PER_DAY`）：
    - `long`：`0.001` / 日（0.1%/日）。`max(0.0, entry_value - margin)`（借りた元本）にかかります。
    - `short`：`0.0005` / 日（0.05%/日）。`max(0.0, entry_value)`（想定元本の全額に対する貸株料）にかかります。
    - `INTEREST_MIN_CHARGE = 10` ペリカ（ティックごとに `interest_acc` に積み上げ、`>= 10` になったら建玉の `margin` から引いて帝愛のハウスに入金します。`margin` が尽きたら、帝愛の債務にあふれます）。
    - **ドキュメントとコードのずれ**：`docs/stocks.md:38` は「手数料も金利もありません」（古い記述）としていますが、`docs/stocks.md:22`、`catalogs/market.yaml:73-76`、`infra/db/margin.py:424-465` は、信用取引の金利を実際にかけています。
- **注文の入力の意味**：
  - `/証券 注文 信用買い` / `空売り` では、ユーザーが渡す `amount` ＝ **差し入れる担保（証拠金）**、`leverage ∈ {1, 2, 3, 5}` です。
  - 目標の想定元本 ＝ `amount * leverage`、`units = int(notional * UNIT // price)`（または `margin_open` が `margin = math.ceil(entry_value / leverage)` を計算します。`entry_value = units * price / UNIT`）。
  - 同じ銘柄で、`long` と `short` を同時には持てません（`margin_opposite_open`）。
  - 同じ向きの既存のポジションに追加すると、1 行 `(guild_id, user_id, symbol, side)` に平均されます（`units += u`、`entry_value += ev`、`margin += m`）。
  - 債務者（`debt > 0`）は、新しい信用取引のポジションを建てられません（`margin_debt_blocks`）。
- **クロスマージンのポートフォリオの純資産と維持率**（`domain/market.py:196-204`、`infra/db/margin.py`）：
  - 現在の価格での、符号つきのエクスポージャーのベクトル `w[s] = +notional`（買い）または `-notional`（売り）。
  - `required_margin(w) = 20.0 * sqrt(max(0.0, w^T Σ w))`。相関のあるヘッジ（たとえば `cs` の買い ＋ `teio` の売り）は分散を相殺し、必要証拠金を減らします。
  - `margin_pnl(side, units, entry_value, price)`：`round(now - entry_value)`（買い）、`round(entry_value - now)`（売り）。ここで `now = units * price / UNIT`。
  - `equity = sum(pos.margin + pnl) + 0.80 * spot_value + 0.95 * normal_bond_principal + 0.50 * junk_bond_principal`。
  - `ratio = equity / required`（建玉がない、または `required == 0` のときは `None`）。
- **強制決済（ロスカット）**（`infra/db/margin.py`）：
  - 1 分ティックごとに、全サーバーで動きます（`margin_losscut`）。
  - `ratio < 1.00` の間、建玉を損益の悪い順に並べ、`ratio >= 1.00` になるか、建玉がなくなるまで、1 つずつ強制的に決済します。
  - **ピンの免除とスリップ**：強制決済はピンのロックを無視するので、暴走した損失も確実に清算されます。戻る現金 `margin + pnl < 0` なら、超過した損失は**帝愛の債務**になります（担保のない不足分として `add_debt_for` で記録）。
  - 一部の決済（`HoldingsView` の `pct`、1..100%）は、`units / have` で `entry_value` と `margin` を按分し、プラスの利益には累進の譲渡益課税をかけます。

### 4. オプションとペア・ワラント（Black-Scholes と Margrabe）
- **定数**（`catalogs/market.yaml:99-130`、`domain/options.py:19-35,87-88`）：
  - `OPTION_HOURS = 6` 時間（満期は固定）。`TICK_SECONDS = 60`。
  - `SPREAD = 0.015`（買いのとき売り気配に +1.5%、売り・買い戻しのとき買い気配に -1.5%。往復で約 3% のスプレッドが帝愛銀行に入ります）。
  - `PAYOUT_CAP_MULT = 50`（買い手の払い戻しは `50 * premium` で頭打ち）。
  - `MIN_PREMIUM = 100`。
  - `MAX_OPEN_PREMIUM = 20_000`（1 ユーザーあたりの、進行中の買いのプレミアムの合計の上限）。
  - `MARGIN_RATE = 0.20`（裸売りの担保 ＝ `0.20 * strike * units / UNIT`）。
  - `MAX_SHORT_MARGIN = 20_000`（1 ユーザーあたりの、進行中の売りの担保の合計の上限）。
  - `MAX_TARGET_PCT = 50`（OTM の目標を自由に決められる範囲は `1..50%`）。
  - 種類：
    - `call`：`🚀 爆騰コール`（`上がると儲かる`）、売り：`コール裸売り`
    - `put`：`📉 暴落プット`（`下がると儲かる`）、売り：`プット裸売り`
    - `pair`：`⚖️ ペア・ワラント`（`相手の銘柄より上がると儲かる`、買いのみ）
- **単一資産の分散と Black-Scholes での値付け**（`domain/options.py:37-122`）：
  - 1 分ティックあたりのジャンプ分散：
    `E[size^2] = (hi^3 - lo^3) / (3 * (hi - lo))`、`lo=0.015, hi=0.035`。
    `jump_var = (1/720) * E[size^2] * min(1.5, σ_sym / σ_cs)^2`。
  - `total_variance(symbol, seconds, now, events)`：
    1. 基本 ＋ パニック：`(seconds / 60) * (Σ_ii + jump_var)`。
    2. `symbol` に有効な、または告知済みのボラティリティイベントがなければ、将来のイベントの期待分散を基準として足します：
       `expected_event_ticks(seconds, 60) * Σ_ii * (2.0^2 - 1)`。ここで `cycle = 300 + 15 + 20 + 60 = 395` 分、`expected_event_ticks = (seconds/60) * 20 / 395 / 4`。
    3. `symbol` に一致する `events` の各イベントについて：
       - 決算（`"jump_var" in ev`）：`now < ev["jump_at"] <= now + seconds` なら、`earnings.jump_variance()` を足します。
       - ボラティリティイベント：`extra_variance_ticks(ev, now, seconds, 60) * Σ_ii * (factor^2 - 1)` を足します（`priced_at_announce = 1.0`。告知された時点で、すぐに完全に織り込まれます）。
  - 金利ゼロのヨーロピアン式 Black-Scholes（`fair_price(kind, S, K, v)`）：
    - `v <= 1e-12` なら：`max(0, S - K)`（コール）または `max(0, K - S)`（プット）。
    - それ以外：`d1 = (ln(S/K) + v/2) / sqrt(v)`、`d2 = d1 - sqrt(v)`。
      `C = S*Φ(d1) - K*Φ(d2)`、`P = K*Φ(-d2) - S*Φ(-d1)`。
  - `ask_per_unit = fair * 1.015 / 1000`、`bid_per_unit = fair * 0.985 / 1000`。
  - `strike = round(spot * (1 + pct), 2)`（コール）または `round(spot * (1 - pct), 2)`（プット）。
  - `intrinsic = int(max(0, ±(spot - strike)) * units / 1000)`。
- **ペア・ワラント（Margrabe の交換オプション）**（`domain/options.py:125-184`）：
  - `pair_variance(a, b, seconds, now, events)`：
    `ticks * (Σ_aa + Σ_bb - 2*Σ_ab + (1/720)*E[size^2]*(scale_a - scale_b)^2)` ＋ 期待または告知済みのイベントの分散の寄与 ＋ `a` か `b` のどちらかの決算の `jump_var`。
  - `pair_fair_rate(rel_a, rel_b, v) = fair_price("call", rel_a, rel_b, v)`。
  - `pair_ask_rate = pair_fair_rate(1.0, 1.0, v) * 1.015`、`pair_bid_rate = pair_fair_rate(rel_a, rel_b, v) * 0.985`。
  - `pair_intrinsic(notional, a0, b0, a_t, b_t) = int(notional * max(0.0, a_t / a0 - b_t / b0))`。
- **裸売り（`side='short'`）**（`domain/options.py:186-189`、`infra/db/options.py`）：
  - 書き手が `margin`（`>= 100`、合計 `<= 20,000`）を差し入れ、`premium = int(units * bid_per_unit)` をすぐに帝愛銀行から受け取ります（銀行の現金でプレミアムを払えないときは、`option_bank_no_cash` で失敗します）。
  - 書き手は、`ask_per_unit * units` で早めに買い戻すか、満期まで持てます。
  - 満期のとき：書き手は `intrinsic` を支払います（書き手には 50 倍の上限は**ありません**。`infra/db/options.py` を確認すると、書き手は `margin` まで払い、不足 `intrinsic - margin` は**帝愛の債務**になります）。
  - 満期の買い手への払い戻し：`min(intrinsic, premium * 50)` を帝愛銀行から払います（順に：現金 → 信託 → 共済）。純利益 `max(0, paid - premium)` は、債務の天引きでは `income` として数えます。
  - ストップ安のピン（`-1`）は、早めの `sell_call` をブロックします（`PIN_LOCKS[-1]`）。

### 5. ボラティリティイベント、スプレッドのアラート、毎週の決算
- **ボラティリティイベント**（`catalogs/market.yaml:132-142`、`domain/market_events.py:20-88`）：
  - 有効な、または告知済みのイベントがなく、前回のイベントの終了から `COOLDOWN_MIN = 60` 分たっているとき、1 分ティックで確率 `1/300`（平均約 5 時間）で発生します。
  - 4 銘柄からランダムに選び、`LEAD_MIN = 15` 分の予告（`announced`）のあと、`DURATION_MIN = 20` 分のあいだ有効（`active`）で、ボラティリティが `FACTOR = 2.0` 倍になります。
  - DB には `KEEP_DAYS = 7` 日分を保持します。
- **相関の崩れのスプレッドのアラート**（`domain/market_events.py:90-121`）：
  - `|ρ| >= 0.5` の組（`cs-teio`、`cs-gold`、`teio-gold`）、期間 `ALERT_WINDOW = 60` 分（`n >= 10` が必要）。
  - `z = (r_a - sign(ρ) * r_b) / sqrt((Σ_aa + Σ_bb - 2 * sign(ρ) * Σ_ab) * n)`。
  - `|z| >= 2.5` のとき `/証券 市況` に表示し、`|z|` の大きい順に並べて、上位 3 件を出します。
- **毎週の決算とインサイダーのメモ**（`catalogs/market.yaml:144-157`、`domain/earnings.py:16-104`）：
  - 対象の銘柄：`teio`、`numa`。
  - 告知：**月曜 09:00**（設定のタイムゾーン、既定は JST）。
  - 発表：**火曜 13:30**（設定のタイムゾーン、既定は JST）。
  - スケジュールの時点で事前に抽選：`direction ∈ {+1, -1}`（50/50）。`surprise` は確率 `0.15`（`size ~ Uniform(0.35, 0.60)`）、そうでなければ通常（`size ~ Uniform(0.08, 0.22)`）で、小数 3 桁に丸めます。
  - 発表のとき：理論価格に `exp(direction * ln(1 + size))` をかけます（対数で対称なので、E[log jump] = 0。サプライズが 30% を超えると、値幅制限を突き抜け、ストップ高・ストップ安に張り付きます）。
  - オプションのための決算のジャンプ分散：`0.85 * E[ln(1+U(0.08,0.22))^2] + 0.15 * E[ln(1+U(0.35,0.60))^2]`（200 区間の中点法の数値積分）。
  - **インサイダーのメモ**：
    - デイリーの受け取りでの抽選（`MEMO_PROB = 0.10`。発表が `MEMO_LEAD_HOURS = 48` 時間以内のときだけ）：正しい確率は `MEMO_TRUTH = 0.70`（30% はガセまたは逆）。
    - 帝愛のショップでの購入（`insider_memo`、`10,000` ペリカ、1 回の決算につきサーバーあたり `SHOP_STOCK = 5`）：正しい確率は `SHOP_TRUTH = 0.80`（20% はガセ）。

### 6. 帝愛の社債と、動的なリスクフリーレート（`r_f`）
- **債券のカタログ**（`catalogs/bonds.yaml:1-22`、`domain/bonds.py:16-80`）：
  - `MIN_AMOUNT = 1_000`。`SALE_DISCOUNT_PER_HOUR = 0.001`。
  - | キー | 名前 | 絵文字 | 満期 | 基本の利率 | 債務不履行の確率 | 1 ユーザーあたりの元本の上限 | 途中売却 |
    |---|---|---|---|---|---|---|---|
    | `normal` | `通常債` | `🏦` | `72h`（3 日） | `4%` | `0%` | `30,000` | できる（DCF） |
    | `junk` | `ジャンク債` | `🗑️` | `24h`（1 日） | `20%` | `20%` | `10,000` | できない |
- **動的なリスクフリーレート `r_f`（CIR 過程）**（`domain/rates.py:14-68`。`docs/spec/teiai.ja.md` と関連）：
  - `BASE_RISK_FREE_PER_DAY = ln(1.04) / 3 ≈ 0.0130737/日`。
  - `teiai.yaml` からの範囲：`RF_MIN = per_day(rf_min_pct, 72)`、`RF_MAX = per_day(rf_max_pct, 72)`。
  - 目標 `μ(θ) = RF_MIN + (RF_MAX - RF_MIN) * exp(-RF_ALPHA * max(0, θ))`（`θ is None` なら `BASE_RISK_FREE_PER_DAY`）。帝愛の準備率 `θ` が低いほど、現金を集めるために債券の利回りが上がります。
  - `days` ぶんの 1 ステップ：`drift = μ + (r - μ) * exp(-RF_KAPPA_PER_DAY * days)`、`noise = RF_SIGMA * sqrt(max(r, 0) * min(days, 1/24)) * z`。`[RF_MIN, RF_MAX]` に収めます。
  - 購入時のクーポンは、購入の時点で固定します：`spread = per_day(kind.rate, kind.hours) - BASE_RISK_FREE_PER_DAY`、`rate_pct = round(max(0, expm1((rf + spread) * kind.hours / 24) * 100), 2)`。
- **途中の DCF 売却（通常債のみ）**（`domain/bonds.py:65-79`、`domain/rates.py:31,65-67`）：
  - `SALE_SPREAD_PER_HOUR = max(0, 0.001 - BASE_RISK_FREE_PER_DAY / 24)`。
  - `discount_per_hour = rf / 24 + SALE_SPREAD_PER_HOUR`。
  - `sale_value = int(maturity_payout * exp(-discount_per_hour * remaining_hours))`。
  - 債券がクロスマージンの担保として必要なときはブロックされます（`check_bond_cancel` が `ratio >= 1.30` を守ります）。
- **ジャンク債の連続的な債務不履行（ポアソンのハザード）**（`domain/bonds.py:53-62`、`infra/db/bonds.py:132-142`）：
  - ハザード率 `λ = -ln(1 - 0.20) / 24 ≈ 0.0092976 / 時間`。
  - ティックごとに、`checked`（なければ `ts`）からの `until = min(now, due)` を使って、`rng.random() < 1 - exp(-λ * elapsed_hours)` を判定します。
  - 債務不履行になると `status = 'defaulted', paid = 0` になり、帝愛銀行が元本を利益として保持します。
- **優先順位と精算**（`infra/db/bonds.py:121-162`）：
  - 債券の元本と利息は、帝愛銀行の**優先的な負債**です（`bank_pay_batch_for` で全額払います。順に：現金 → 信託 → 共済）。
  - 満期のとき：`interest` は `income` の天引きを発動します（債務者なら 30%）。`principal` は `repay_all_of_for` で適用されます（まず、帝愛の債務の返済に 100% 充てられます）。
  - 債務者（`debt > 0`）は、新しい債券を買えません（`debt_blocks`）。

## タイマーとスケジュール
- **1 分ごとの全体の市場ループ**（`cogs/market/cog.py:316-395`）：
  1. 全体の価格を進め（`next_prices`）、理論価格と制限後の価格、ピンの状態を記録し、30 日を超える履歴を削除します。
  2. ボラティリティイベント（`market_events`）の抽選と維持を行い、毎週の決算の発表（火曜 13:30）と告知（月曜 09:00）を確認します。
  3. サーバーごとに：満期または債務不履行になった債券の精算、期限切れのオプションの精算、信用取引の金利の加算、信用取引のロスカットを行います。
  4. 決算の告知と結果を投稿し（`feed.earnings_posts`）、有効なライブチャートを編集します（`LIVE_MINUTES = 60`）。
- **UI のビューのタイムアウト**：`HoldingsView` ＝ `600s`、`MarketView` ＝ `300s`、`ConfirmView` ＝ `30s`（`confirm_from = 5,000`）。

## 状態機械
- **債券の流れ**：`active` --（ジャンク債のハザードの抽選に当たる）--> `defaulted`（`paid=0`）、`active` --（途中売却、または破産の差し押さえ）--> `cancelled`、`active` --（`now >= due`）--> `paid`。
- **オプションの流れ**：`active` --（途中の売却・買い戻し）--> `sold`、`active` --（`now >= expiry` かつ `intrinsic > 0`）--> `exercised`、`active` --（`now >= expiry` かつ `intrinsic == 0`）--> `expired`。
- **市場イベント**：`announced`（`now < start_ts`）→ `active`（`start_ts <= now < end_ts`）→ `done`（`now >= end_ts`）。
- **決算**：scheduled → announced（月曜 09:00）→ released（火曜 13:30）。

## エッジケース
- 信用取引のポジションを持ったまま、現物を売る、または通常債を取り消すと、`check_spot_sell` / `check_bond_cancel` が働き、売却後の維持率が `OPEN_RATIO = 1.30` を下回るなら失敗します。
- 破産のときは、現物（`taxable=False`）、信用取引のポジション、通常債（`bond_write_off_for`）を強制的に清算します。
- `MarketView` はオーナーごと（`OwnerView`）で、自動更新されません。`/証券 市況` は、更新されない対話型のビューを投稿し、ライブチャート（`chart_posts`）は、60 分のあいだ、その場で編集されます。
- `/債券` のコマンドの cog（`cogs/market/bond_cog.py`）は、ユーザーを `/証券 注文 債券` と `/証券 保有` に案内する、旧版からの転送のメッセージとしてだけ残してあります。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `market.group_name` | `証券`（`📈 株・信用・オプション・債券の取引`） | `cogs/market/cog.py` |
| `market.event_up` | `📈 急騰！` | `cogs/market/embeds.py:20` |
| `market.event_down` | `📉 急落！` | `cogs/market/embeds.py:20` |
| `market.tax_line` | `🕴️ 帝愛の税（利益の累進課税）: **−{tax:,}ペリカ**（帝愛銀行の収入になります）\n` | `cogs/market/embeds.py:27` |
| `market.margin_ratio` | `{mark} **口座の維持率 {ratio:.0%}**　有効証拠金 {equity} ÷ 必要証拠金 {req}\n（{losscut:.0%} を下回ると、損の大きい建玉から強制決済。現物・債券は担保に数えます）` | `cogs/market/embeds.py:48-51` |
| `market.pin_banner` | `\n**{mark}に張り付き中**　約定しない売買: {locked}` | `cogs/market/embeds.py:135` |
| `market.pin_down_err` | `🚨 {name} は**ストップ安に張り付いています**。{act}は、買い手がいなくて約定しません（下げが止まるまで、待つしかありません）。` | `cogs/shared/messages/market.py:25-26` |
| `market.pin_up_err` | `🚀 {name} は**ストップ高に張り付いています**。{act}は、売り手がいなくて約定しません（上げが止まるまで、待つしかありません）。` | `cogs/shared/messages/market.py:34-35` |
| `market.ev_active` | `⚡ **発生中**　{emoji}{name} の値動きが **{factor:g}倍**（<t:{end_ts}:R> まで）。上がるか下がるかは分かりませんが、大きく動きます。` | `cogs/market/embeds.py:160-163` |
| `market.ev_announced` | `📢 **予告**　{emoji}{name} の値動きが、<t:{start_ts}:R> から {dur}分間、**{factor:g}倍**になります。上がるか下がるかは分かりませんが、大きく動きます。オプションの値段には、もう織り込まれています。` | `cogs/market/embeds.py:164-167` |
| `market.earnings_announce_title` | `📢 今週の決算発表` | `cogs/market/embeds.py:384` |
| `market.earnings_result_title` | `📊 {name} 決算発表: {好決算！\|悪決算…}` | `cogs/market/embeds.py:396` |
| `market.summary_title` | `📈 市況（全銘柄）` | `cogs/market/embeds.py:285` |
| `market.holdings_title` | `💼 証券` | `cogs/market/embeds.py:315,365` |
| `market.holdings_empty` | `まだ持っていません。\`/証券 注文 現物\` などで買えます。` | `cogs/market/embeds.py:315` |
| `market.holdings_owner_only` | `自分の \`/証券 保有\` で操作してください。` | `cogs/market/views.py:50` |
| `market.view_owner_only` | `自分の \`/証券 市況\` で操作してください。` | `cogs/market/views.py:186` |
| `market.modal_pct_title` | `手放す割合` / `割合（1〜100の数字。100で全部）` | `cogs/market/views.py:25-27` |
| `market.bond_buy_title` | `{emoji} {name}を買いました` | `cogs/market/embeds.py:453` |
| `market.err_collateral_locked` | `信用取引の担保になっているので、売れません（売ると維持率が {ratio:.0%}・{open_ratio:.0%} 以上が必要）。先に建玉を決済してください。` | `cogs/shared/messages/market.py:46-47` |
| `market.err_margin_opposite` | `{name}の{other_label}を建てています。先に決済してください。` | `cogs/shared/messages/market.py:53` |
| `market.err_margin_ratio` | `口座の維持率が足りなくなります（建てると {ratio:.0%}・{open_ratio:.0%} 以上が必要）。証拠金を減らすか、レバレッジを下げるか、現物や債券を担保に持ってください。` | `cogs/shared/messages/market.py:67-68` |
| `market.err_opt_bank_no_cash` | `いま帝愛銀行の手元の現金が足りず、プレミアムを払えません（準備率が低いとき）。` | `cogs/shared/messages/market.py:88` |
| `market.err_bond_min` | `{min_amount:,}ペリカ以上で買ってください。` | `cogs/shared/messages/market.py:91` |
| `market.err_bond_max` | `{name}は元本の合計が {max_total:,}ペリカ まで（いま {held:,}ペリカ 保有）。あと {room:,}ペリカ まで買えます。` | `cogs/shared/messages/market.py:93-94` |
| `market.err_bond_unsellable` | `{name}は売れません（満期まで持つだけです）。` | `cogs/shared/messages/market.py:97` |
| `market.ledger_spot_buy` | `{name}購入:{lots}@{fmt_price}` | `infra/db/crypto.py:122` |
| `market.ledger_spot_sell` | `{name}売却:{lots}@{fmt_price}` | `infra/db/crypto.py:172` |
| `market.ledger_bond_buy` | `債券購入:{name}` | `infra/db/bonds.py:77` |
| `market.ledger_bond_mature` | `債券償還:{name}` | `infra/db/bonds.py:156` |
| `market.ledger_bond_sell` | `返金:債券売却` | `infra/db/bonds.py:249` |
| `market.ledger_bond_seize` | `破産:債券の差し押さえ` | `infra/db/bonds.py:219` |
