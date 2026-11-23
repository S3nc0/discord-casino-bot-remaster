[English](crypto.md) | **日本語**

# 暗号資産（CSトークンと現物台帳）仕様

担当：`B3` | 画面 ID：`stocks`、`stocks-detail`（`packages/shared/src/ids.ts`） | 機能トグル：`market`

> 設計メモ：もともとは `CSトークン` のための独立した `/暗号` モジュールでしたが、暗号資産は `/証券` に統合され（`docs/stocks.md:25`）、`TEIO重工`、`NUMAバイオ`、`GOLD地金` と並ぶ銘柄になりました。旧コードでは `cs`（`CSトークン`）が `DEFAULT` の銘柄のままで、4 銘柄すべての現物保有は、`CryptoRepo` が管理する SQLite の `crypto` テーブルにあります。共通のコレスキー分解による価格エンジン、信用取引、オプション、債券、UI パネルは `docs/spec/stocks.ja.md` を参照してください。

## 元ファイル
- `catalogs/market.yaml:10-22,41-53,64-72,80-81`
- `docs/stocks.md:1-35`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/market.py:22-23,39-48,176-186,211-265`
  - `infra/db/crypto.py:1-192`
  - `cogs/shared/messages/market.py:42-51`
  - `cogs/market/embeds.py:54-62,322-330`

## ルールと正確な数値

### 1. CSトークンのパラメーター（`catalogs/market.yaml:17-22`）
- 銘柄キー：`cs`（`domain/market.py:41-42`、`DEFAULT = "cs"`。互換のための別名 `NAME = "CSトークン"`、`START_PRICE = 1000.0`、`SIGMA = 0.0012`）。
- 表示：`🪙 CSトークン`。
- `start = 1000.0` ペリカ / 1 トークン（`1.000枚`）。
- `sigma = 0.0012`（1 分ティックあたり）。4 銘柄すべてのパニックショックの倍率を決める、基準のボラティリティの分母（`sym.sigma / CS.sigma`）にもなります。
- `drift = 0.008`（1 日あたりの対数成長。対数価格で直線的に弱まり、開始価格の `8` 倍 ＝ `8,000` ペリカで `0` になります）。
- 相関：`teio` と `+0.60`、`numa` と `+0.05`、`gold` と `-0.60`。
- 価格の範囲：`MIN_PRICE = 20`、`MAX_PRICE = 50_000`。値幅制限：24 時間前の基準に対して `±30%`。
- オプションの OTM の既定のストライクのずれ：`3%`（`strike_by_symbol.cs = 0.03`）。
- 決算の対象：**なし**（週ごとの決算があるのは `teio` と `numa` だけです。`cs` はランダムな 2 倍ボラティリティのイベントの対象です）。

### 2. ミリ単位の現物の会計（`CryptoRepo`）
- 精度：`UNIT = 1000`（`packages/shared/src/ids.ts` の `QUANTITY_SCALE = 1000`）。
  - 保存する `1` 単位 ＝ `0.001枚`（1 ミリトークン／1 `口`）。
  - 表示の形式：`lots(units) = f"{units / 1000:,.3f}枚"`。
- 取引手数料：`FEE_RATE = 0.0`（`_fee(gross) = math.ceil(gross * FEE_RATE)`）。
- **買いの見積もり**（`domain/market.py:215-224`）：
  - 入力：予算 `amount`（整数のペリカ）と、現在の `price`（float）。
  - 最初の見積もり：`units = int(amount * 1000 // (price * (1 + FEE_RATE)))`。
  - `gross + fee > amount` の間、`units` を 1 ずつ減らします。ここで `gross = math.ceil(round(units * price / 1000, 6))`、`fee = math.ceil(gross * FEE_RATE)` です。
  - `(units, gross + fee, fee)` を返します。`units == 0` なら `(0, 0, 0)`。
  - 注意：`gross` は `math.ceil` を使うため、実際に使う `total` が `amount` よりわずかに少ないことがあります（使わなかった端数はプレイヤーの手元に残ります）。
- **売りの見積もり**（`domain/market.py:227-231`）：
  - `gross = int(round(units * price / 1000, 6) // 1)`（小数 6 桁で丸めてから切り捨て。float の 1 ずれを避けるため）。
  - `fee = math.ceil(gross * FEE_RATE)`。
  - `(max(0, gross - fee), fee)` を返します。
- **平均取得単価と損益**（`domain/market.py:234-242`、`infra/db/crypto.py:124-128,166-182`）：
  - `(guild_id, user_id, symbol)` ごとに `(units, cost)` で保存します。`cost` は、累計で使った整数のペリカです。
  - 買いのとき：`units += bought_units`、`cost += total_paid`。
  - `have` 単位のうち `u` を一部売るとき：
    `removed_cost = cost if u == have else round(cost * u / have)`（コストの端数が残らないよう、Python の銀行丸め）。
  - 確定損益：`profit = proceeds - removed_cost`。
  - `avg_price = cost * 1000 / units`、`pnl_percent = (price - avg_price) / avg_price * 100`。

### 3. 検証、税、担保のルール（`infra/db/crypto.py:92-191`）
- **買い（`crypto_buy`）**：
  1. ユーザーのアカウントを確認します（新規なら初期残高 `3,000`）。
  2. `amount <= 0 or price <= 0` は拒否します（`crypto_invalid_amount`）。
  3. 銘柄がストップ高に張り付いている（`+1` で `buy_spot` をブロック）なら拒否します。
  4. `debt > 0` なら拒否します（`debt_blocks`、動詞 `"買えません"`）。
  5. `raw_balance < amount` なら拒否します（`crypto_insufficient_balance`）。
  6. `buy_quote` が `units < 1` を返したら拒否します（`crypto_amount_too_small`）。
  7. 台帳の理由 `"{name}購入:{lots}@{fmt(price)}"` で `total` を引きます（`income` なし）。
- **売り（`crypto_sell`）**：
  1. 銘柄がストップ安に張り付いている（`-1` で `sell_spot` をブロック）なら拒否します。
  2. `have > 0` なら `collateral_guard.check_spot_sell` を実行します。現物の保有は、クロスマージンの純資産に **80% の掛け目**（`COLLATERAL_HAIRCUT.spot = 0.8`）で数えられ、売ったあとの維持率が `OPEN_RATIO = 1.30` を下回るなら拒否します（`crypto_collateral_locked`）。
  3. `have <= 0`（`crypto_not_held`）、`units < 1 or units > have`（`crypto_sell_range`）、`proceeds < 1 and units != have`（`crypto_proceeds_too_small`）は拒否します。
  4. `taxable=True` のとき（強制破産の差し押さえ中は無効）、`profit = proceeds - removed_cost` に累進の譲渡益課税（`0% / 3% / 7% / 12%`）をかけます。
  5. 台帳の理由 `"{name}売却:{lots}@{fmt(price)}"` で `proceeds - tax` を入金します（`income=0`。自分の現物資産を売っても、帝愛の 30% の債務の天引きは**かかりません**。ただし譲渡益課税は帝愛に入ります）。
  6. `units == have` なら `crypto` の行を削除し、そうでなければ残りの `units` と `cost` を更新します。
- **ランキングでの評価**（`infra/db/crypto.py:74-90`）：
  - 価格が記録されているすべての銘柄について、現在の `sell_quote(units, latest_price)[0]` で評価します。

## 状態機械
- `(guild_id, user_id, symbol)` ごとに：
  - `NO_POSITION` --（`crypto_buy`、`units >= 1`）--> `HOLDING(units, cost)`
  - `HOLDING(units, cost)` --（`crypto_buy`）--> `HOLDING(units + u, cost + total)`
  - `HOLDING(units, cost)` --（`crypto_sell` の一部売り、`u < units`）--> `HOLDING(units - u, cost - removed)`
  - `HOLDING(units, cost)` --（`crypto_sell` の全部売り、`u == units`、または破産時の清算）--> `NO_POSITION`（行を削除）

## エッジケース
- 全部売り（`units == have`）は、`proceeds == 0` でも許可されます（端数の保有をきれいに片づけるため）。一方、`proceeds < 1` の一部売りは `crypto_proceeds_too_small` で失敗します（`infra/db/crypto.py:164`）。
- `crypto_buy` は、実際に使う（丸めた）`total`（`<= amount`）を計算する**前**に、`bal < amount`（ユーザーが指定した予算）を確認します。
- 現物の売りは `AccountCore.apply` に `income=0` を渡すため、債務者が現物を売っても、カジノの勝ち分やデイリーと違い、手取り（譲渡益課税のあと）の 30% を天引きで失うことはなく、100% 手元に残ります。
- 現在の旧ボットに、独立した `/暗号` スラッシュコマンドはありません。現物の注文はすべて `/証券 注文 現物` と `/証券 保有` を通ります。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `crypto.symbol_name` | `CSトークン`（`🪙`） | `catalogs/market.yaml:18-19` |
| `crypto.err_invalid_amount` | `金額が正しくありません。` | `cogs/shared/messages/market.py:42` |
| `crypto.err_balance` | `ペリカが足りません（残高 {balance:,}ペリカ）。` | `cogs/shared/messages/market.py:43` |
| `crypto.err_too_small` | `その金額では 0.001枚も買えません。金額を増やしてください。` | `cogs/shared/messages/market.py:44` |
| `crypto.err_collateral` | `信用取引の担保になっているので、売れません（売ると維持率が {ratio:.0%}・{open_ratio:.0%} 以上が必要）。先に建玉を決済してください。` | `cogs/shared/messages/market.py:46-47` |
| `crypto.err_not_held` | `{name}を持っていません。` | `cogs/shared/messages/market.py:49` |
| `crypto.err_sell_range` | `売れるのは 0.001〜{max_lots} です（持っている分）。` | `cogs/shared/messages/market.py:50` |
| `crypto.err_proceeds_small` | `その数量では受け取れる額が 1ペリカ未満です。もう少し多く売ってください。` | `cogs/shared/messages/market.py:51` |
| `crypto.pos_text` | `保有: **{lots}**\n取得 {avg} → いま {price}　{arrow}**{pct:+.1f}%**\n評価損益: **{diff:+,}ペリカ**（売ったときの手取り {value}）` | `cogs/market/embeds.py:60-61` |
| `crypto.ledger_buy` | `{name}購入:{lots}@{price}` | `infra/db/crypto.py:122` |
| `crypto.ledger_sell` | `{name}売却:{lots}@{price}` | `infra/db/crypto.py:172` |
