[English](companies.md) | **日本語**

# 会社（`/会社`）仕様

担当：`B3` | 画面 ID：`company`、`company-invest`（`packages/shared/src/ids.ts`） | 機能トグル：`company`（OFF でも常に使えるのは `会社 状況` と `会社 持分`）

## 元ファイル
- `catalogs/company.yaml:1-35`
- `docs/company.md:1-46`
- `legacy/python/domain/company.py:1-170`
- `legacy/python/infra/db/company.py:1-459`
- `legacy/python/services/company.py:1-76`
- `legacy/python/cogs/company/cog.py:1-165`
- `legacy/python/cogs/company/embeds.py:1-112`
- `legacy/python/cogs/company/texts.py:1-25`
- `legacy/python/cogs/company/views.py:1-151`
- `legacy/python/cogs/shared/messages/economy.py:23-53`
- `legacy/python/cogs/shared/messages/notices.py:21-24`

## ルールと正確な数値

### 1. 設立、レベル、維持費、上限（`catalogs/company.yaml:3-15`、`domain/company.py:20-36,51-84`）
- 1 人につき 1 サーバーで 1 社まで（すべての会社は帝愛の子会社です）。
- 社名の検証（`check_name`）：前後の空白を除いて `1..12` 文字（`NAME_MAX = 12`）。`@<>`*_~|#:/\\\n\r` のどれかを含む名前と、部分文字列 `"http"`（大文字小文字を区別しない）を含む名前は使えません。
- **設立費**：合計 `200,000` ペリカ（`FOUND_FEE = 100_000` → `bank_income_for` で帝愛銀行へ、`BUILD_COSTS[0] = 100_000` → `house_receive_for` で帝愛の胴元口座へ）。
- 設立、自社への出資、他社への出資ができるのは、`🟢 カタギ` だけです（`company_katagi_only`）。
- **施設のレベル（Lv1〜Lv5）**（`BUILD_COSTS = [100_000, 200_000, 400_000, 800_000, 1_600_000]`）：
  | レベル | 増築費（会社の資金 → 胴元） | 累計 `invested(level)` | 1 日の維持費（`0.3%`） | 外部の出資の上限（`2.0x`） |
  |---|---|---|---|---|
  | `Lv1` | `100,000`（設立時） | `100,000` | `300` | `200,000` |
  | `Lv2` | `200,000` | `300,000` | `900` | `600,000` |
  | `Lv3` | `400,000` | `700,000` | `2,100` | `1,400,000` |
  | `Lv4` | `800,000` | `1,500,000` | `4,500` | `3,000,000` |
  | `Lv5` | `1,600,000` | `3,100,000` | `9,300` | `6,200,000` |
- `UPKEEP_RATE = 0.003`（1 日に `int(invested * 0.003)` を、ローカル `00:00` に差し引き → `house_receive_for`）。
- `BANKRUPT_DAYS = 3`：維持費を 3 日連続で払えないと、会社を削除し、残った `funds` は `house_receive_for` が引き取り、すべての出資者の持分は消えます。公開の `🏚️ 倒産` 告知と `company_bankrupt` の通知が出ます。
- 施設の種類の変更（`company_change_kind`）：会社の資金から `100,000`（→ 胴元）かかり、`Lv1` に戻り、建設費の累計と倉庫の在庫がリセットされます。

### 2. 施設の種類、毎日の天候・市況の乱数、生産（`catalogs/company.yaml:19-35`、`domain/company.py:73-137`）
- `STORAGE_DAYS = 3`（`storage_cap = daily_output * 3`。あふれた分は捨てます）。
- `PINHANE_RATE = 0.03`（出荷額の 3% をピンハネ）。
- `DAILY_GRANT = 30_000`（`teiai_house.balance` が尽きたときの、サーバー全体の 1 日の買取枠）。
- **決定論的な毎日の状態（`day_state(kind, guild_id, day)`）**：
  - シードは `random.Random(f"company:{kind}:{guild_id}:{day}")`（`day` は設定のタイムゾーン、既定は JST の `YYYY-MM-DD`）。
  - `rng.choices` で重み付きに状態を選び、`price = round(rng.uniform(price_lo, price_hi), 2)` とします。
- **種類と状態**：
  - `farm`（`🌾 農場`、`yield_rate = 0.018` / 日）：
    | キー | 表示名 | 重み | `yield_mult` | `price_lo..price_hi` |
    |---|---|---|---|---|
    | `sunny` | `☀️ 晴れ` | `40`（40%） | `1.0` | `0.9..1.1` |
    | `rain` | `🌧️ 恵みの雨` | `20`（20%） | `1.3` | `0.8..1.0` |
    | `bumper` | `🌾 豊作` | `10`（10%） | `1.8` | `0.6..0.8` |
    | `drought` | `🥀 日照り` | `15`（15%） | `0.5` | `1.3..1.5` |
    | `storm` | `🌀 嵐` | `5`（5%） | `0.1` | `1.5..1.9` |
    | `season` | `🍂 旬` | `10`（10%） | `1.0` | `1.4..1.6` |
  - `mine`（`⛏ 採掘場`、`yield_rate = 0.024` / 日）：
    | キー | 表示名 | 重み | `yield_mult` | `price_lo..price_hi` |
    |---|---|---|---|---|
    | `steady` | `⛏ 平常操業` | `1`（100%） | `1.0` | `0.9..1.1` |
- **連続生産（`produce`）**：
  - 暦の日をまたいで 1 秒単位で積分します：`stock += (end - cursor) * (daily_output / 86400) * day_state(...).yield_mult`。`storage_cap` で頭打ちです。
- **出荷の売却と予算の上限（`sale`）**（`domain/company.py:123-137`、`infra/db/company.py:232-266`）：
  - サーバーの買取予算 ＝ `teiai_house.balance + house_grant_left(day, 30_000)`。
  - `gross = int(stock * price)`、`net = gross - int(gross * 0.03)`。
  - `net <= budget` なら 100% を売り、`(net, gross - net, 0.0)` を返します。
  - そうでなければ（一部だけ買い取り）：`fraction = budget / net`、`sold_gross = int(gross * fraction)`、`paid = min(budget, sold_gross - int(sold_gross * 0.03))`、`left_stock = stock * (1 - fraction)`。
  - 支払いはまず `teiai_house.balance` から出し、`paid - from_house` の分は、1 日の買取枠を使います。
  - `paid` は `company.funds` に入り、`sold_total` に加算されます。

### 3. 外部の出資と配当（`domain/company.py:143-170`、`infra/db/company.py:309-380`）
- `/会社 出資`：`STAKE_MIN = 1_000` ペリカ。自分自身には不可。出資者は `katagi` である必要があり、会社への出資の合計は `<= 2.0 * invested(level)` です。
- 払い戻しはできません。`company.funds` に入り、`company_stakes(guild_id, owner_id, investor_id, amount, dividends)` で追跡します。
- **引き出しのロック**（`infra/db/company.py:216-226`）：社長が自分の現金に引き出せるのは `max(0, funds - sum(stakes))` までです（出資された資金は、増築と維持費には使えます）。
- **配当**：社長が `dividend_rate ∈ [0.0, 0.50]` を設定します（`DIVIDEND_MAX = 0.5`。`/会社 配当率 0..50`）。
  - 出荷のたびに `pool = int(paid * rate)` を、`company.funds` から出資者へ `pool * stake_amount // total_stakes` ずつ支払います（`配当:{name}`、`income=0`。注意：`infra/db/company.py:254` は `income` を渡して**いません**）。端数は `company.funds` に残ります。
- **総資産での評価（`stake_values`）**（`domain/company.py:158-169`）：
  - `company_value = funds + invested(level)`。
  - `total_stakes > 0` なら、`scale = min(1.0, max(0, company_value) / total_stakes)`。各出資者は `int(amt * scale)` で評価し、社長は `max(0, company_value - total_stakes)` で評価します。ランキングで二重計上しないための仕組みです。
- **差し押さえと自己破産**（`infra/db/company.py:406-459`）：
  - 強制執行（`CompanySeizureStep`）：`company.funds` から `need` までを差し押さえます（出資された資金も対象。施設には手をつけません）。
  - 自己破産（`CompanyLiquidationStep`）：会社を解散し、すべての持分を消し、残った `company.funds` を破産のプールに差し押さえます。

## タイマーとスケジュール
- **10 分ごとのメンテナンスループ（`CompanyCog.tick`）**：すべての会社を精算し（`produce` とローカル `00:00` の維持費）、倒産（`🏚️ 倒産`）を `announce_channel` に告知します。
- **ビューのタイムアウト**：`CompanyPanel` = `600s`、`KindView` = `180s`。

## 状態機械
- `NO_COMPANY` --（`/会社 設立`、-200,000）--> `ACTIVE(Lv1, unpaid=0)`
- `ACTIVE` --（増築）--> `ACTIVE(Lv+1)`（Lv5 まで）
- `ACTIVE` --（種類の変更、資金 -100,000）--> `ACTIVE(Lv1, stock=0)`
- `ACTIVE` --（維持費の 3 日連続未払い、または社長の自己破産）--> `NO_COMPANY`（削除、持分は消滅）。

## エッジケース
- 出資者への配当（`infra/db/company.py:254`）は `income=0` で入金します（出資者があとで債務を抱えても、帝愛の 30% の天引きはかかりません）。
- 社長の個人の引き出し（`infra/db/company.py:229`）も `income=0` で渡します（自分のお金のため）。
- 社長が施設の種類を変えて `Lv` が `1` に戻ると、既存の外部の出資が、新しい `Lv1` の `stake_cap`（`200,000`）を超えることがあります。既存の持分はそのまま残り、新しい出資だけが受け付けられなくなります（`room <= 0`）。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `company.group_name` | `会社`（`🏢 会社（帝愛の子会社を作って、製品を売る）`） | `cogs/company/cog.py:46` |
| `company.found_ok` | `🏢 会社を設立しました` / `{user} が、帝愛の子会社 **{name}**（{kind}）を設立しました。` | `cogs/company/cog.py:64-65` |
| `company.stake_ok` | `🤝 出資しました` / `{user} が、{owner} の **{name}** に **{amount}** を出資しました（この会社への出資の合計 {total}）。\n出資は払い戻しできません。配当は、社長が決めた配当率で、出荷のたびに届きます。` | `cogs/company/cog.py:89-92` |
| `company.div_ok` | `配当率を決めました` / `これからの出荷では、買取代金の **{rate:.0%}** を出資者に配ります。` | `cogs/company/cog.py:110` |
| `company.bankrupt_post` | `🏚️ 倒産` / `<@{uid}> の **{name}** は、維持費を払えない日が続いたため倒産しました。` | `cogs/company/cog.py:143-144` |
| `company.panel_btns` | `📦 出荷する`、`💴 出資する`、`🏧 引き出す`、`🏗️ 増築する`、`🔁 種類を変える`、`🔄 更新` | `cogs/company/views.py:76-81` |
| `company.owner_only` | `これは他の人の会社です。\`/会社 状況\` で自分の会社を開けます。` | `cogs/company/views.py:60` |
| `company.holdings_title` | `🤝 出資先` | `cogs/company/embeds.py:79,91` |
| `company.err_katagi` | `帝愛への借金や、延滞中の貸付がある間は、会社の設立と出資はできません。` | `cogs/shared/messages/economy.py:29` |
| `company.err_no_budget` | `帝愛の買取予算（胴元の口座と、今日の買取枠）が尽きていて、いまは買い取ってもらえません。日付が変わると、買取枠が戻ります。` | `cogs/shared/messages/economy.py:37` |
| `company.err_locked` | `会社資金は、出資者から預かっている {locked:,}ペリカ を超える分しか引き出せません（出資者のお金は、増築や維持費には使えます）。` | `cogs/shared/messages/economy.py:41-42` |
| `company.ledger_found` | `会社設立:{name}（設立費・建設費）` | `infra/db/company.py:172` |
| `company.ledger_invest` | `会社へ出資:{name}` / `会社から引き出し:{name}` | `infra/db/company.py:198,229` |
| `company.ledger_stake` | `出資:{name}` / `配当:{name}` | `infra/db/company.py:254,330` |
