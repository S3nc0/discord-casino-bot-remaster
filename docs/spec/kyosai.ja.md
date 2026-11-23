[English](kyosai.md) | **日本語**

# 帝愛共済（`/共済`）仕様

担当：`B3` | 画面 ID：`kyosai`（`packages/shared/src/ids.ts`） | 機能トグル：`kyosai`（OFF でも常に使えるのは `共済 状況` と `共済 取消`）

## 元ファイル
- `catalogs/teiai.yaml:76-95`
- `docs/teiai.md:64-80`
- 元の Python ボット（v1.0.0 より前の git 履歴を参照）。パスはそのフォルダからの相対パスです：
  - `domain/kyosai.py:1-77`
  - `infra/db/kyosai.py:1-560`
  - `services/kyosai.py:1-95`
  - `cogs/kyosai/cog.py:1-410`
  - `cogs/shared/messages/economy.py:57-77`
  - `cogs/shared/messages/notices.py:31-38`

## ルールと正確な数値

### 1. 固定の供給量と、最後の受け皿（`catalogs/teiai.yaml:77-94`、`domain/kyosai.py:17-34`）
- **サーバーごとの固定供給量**：`TOTAL_UNITS = 10_000` 口（`1` 口 ＝ `0.01%`）。増やしたり消したりはしません。
- 初期状態（`_ensure_supply_for`）：`10,000` 口すべてが `HOUSE = 0`（`user_id = 0`）のもので、帝愛のオークションで売り出されます。
- 新しいアカウントに付与する口は **0** です。プレイヤーが口を手に入れる方法は、**帝愛のオークション**（`/共済 入札`）か、**P2P の譲渡**（`/共済 譲渡` → `/共済 受諾`）です。
- **按分（`kyosai.split`）**（`domain/kyosai.py:36-46`）：
  - 最大剰余（ハミルトン）方式で、持分の合計がちょうど `amount` になるようにします。同じ余りなら、`user_id` が小さいほうを先にします。
- **超過損失の受け皿（`charge_excess_for`）**（`infra/db/kyosai.py:122-152`）：
  - 帝愛銀行からの流出が、`cash` と帝愛信託（とサーモスタットによる救済）の両方を使い切ったときに発動します。
  - `amount` を、`HOUSE` を含む**全 `10,000` 口**に按分します。
  - `HOUSE` の分は支払われません（`teiai_bank.excess_unpaid` として記録）。
  - プレイヤーの保有者は、それぞれ現金の残高から支払います（`共済:超過損失の負担`）。足りない分は**帝愛の債務**になり（`共済:超過損失の負担（借金 {rest:,}ペリカ）`）、`after_debt_change` を呼びます。

### 2. 毎日の配当と、休眠した口の回収（`infra/db/kyosai.py:157-210`）
- `24h`（`86,400s`）ごとに 1 回動きます（`teiai_bank.kyosai_div_ts` で管理。最初のティックは時刻の初期化だけ）。
- ステップ 1 — **休眠の回収（`DORMANT_DAYS = 30`）**：
  - ハウス以外の各保有者について、`ledger.ts` の最新を調べます。ただし受け身の記録 `('共済:配当', '帝愛信託:利息')` と `'共済:超過損失の負担%'` は除きます（なければ `users.created_at`）。
  - `last < now - 30 * 86400` なら、その人の口はすべて `HOUSE` に戻り、その人が出していた売りのオファーはすべて取り消されます。
  - 破産でも、すべての口が評価額 0 で `HOUSE` に回収されます（`KyosaiLiquidationStep`）。
- ステップ 2 — **余剰の配当（`dividend_pool`）**（`domain/kyosai.py:49-54`）：
  - `TARGET_RATIO = 0.30`、`DIVIDEND_SHARE = 0.05`、`DIVIDEND_CAP = 50_000`。
  - `surplus = available_cash - 0.30 * (deposits + active_bond_principal)`。
  - `surplus > 0` なら `pool = min(50_000, int(surplus * 0.05))`、そうでなければ `0`。
  - 全 `10,000` 口に按分します。`HOUSE` の分は銀行に残ります。プレイヤーの分は、`thermo=False` で銀行から支払い、`income=share` で入金します（30% の債務の天引きの対象）。

### 3. 帝愛ハウスの口のオークション（`infra/db/kyosai.py:215-286`）
- 1 回のオークションにつき `AUCTION_LOT = 100` 口（`min(house_units, 100)`）、`AUCTION_HOURS = 24` 時間、`AUCTION_MIN_BID = 1` ペリカ。
- 流動性のゲートが閉じていても動きます（落札の代金は、帝愛銀行に現金を入れるため）。
- 入札（`/共済 入札`）：
  - 債務者（`debt > 0`）は入札できません（`debt_blocks`）。
  - 次の最低入札額は `p2p.min_next_bid(1, top_bid)` を再利用します（まだ入札がなければ `1`、あれば `top_bid + max(100, ceil(top_bid * 0.05))`）。
  - 入札は現金の残高からエスクローします。自分の最高入札を引き上げるときは、`bal + own >= amount` だけを確認し、先に古い最高入札を返金してから、新しい額を引きます。
  - スナイプ対策：`p2p.end_after_bid` を再利用します（終了前 5 分以内の入札で、終了が `now + 300s` に延びます）。
  - 破産猶予に入るか、破産を宣言すると、開いている最高入札を引き戻します（`kyosai_pull_back_for`）。現金を返金し、`top_bid = 0, top_bidder = NULL` に戻します。
- 精算：`now >= ends` で、`HOUSE` から `top_bidder` へ `units` を移し、`bank_income_for` で `top_bid` を銀行に入金し、`house > 0` なら、すぐに次の枠を開きます（売れ残りの再出品は、スパム防止のため告知しません）。

### 4. 口の P2P 譲渡と、流動性のゲート（`infra/db/kyosai.py:290-396`）
- **流動性のゲート（`gate_locked`）**（`domain/kyosai.py:57-59`）：
  - `grace_debtors > 0` または `(theta is not None and theta < 0.20)` のときは、常に閉じます（`kyosai_gate_locked`）。
  - 取り付け騒ぎのときに、事情を知る人が負担を押しつけて逃げないよう、P2P の口のオファーの作成（`/共済 譲渡`）と受諾（`/共済 受諾`）の両方を止めます。
- オファーの条件：`units >= 1`、`0 <= price <= 100,000`（`p2p.PAIR_DAILY_LIMIT`）、`buyer != seller`、`buyer != 0`、有効期限は `OFFER_HOURS = 24` 時間。
- 受諾：買い手の `debt == 0`、現金 `>= price`、24 時間の 2 者間の取引量の合計（`kyosai_offers + market_listings <= 100,000`）を確認します。
- 手数料：`5%`（`p2p.fee_of(price)`）を売り手の受け取りから引いて、帝愛銀行に入金します。売り手の手取りは `income = net` で入金します。
- 売り手と買い手のどちらでも、開いているオファーを取り消せます（`/共済 取消`）。

### 5. ガバナンスの動議（信託の上乗せ金利）（`infra/db/kyosai.py:400-525`）
- `teiai_bank.trust_premium`（帝愛信託の利息のために `r_f` に足す、日々の連続の上乗せ金利）を決めます。
- 有効な範囲：`0 < premium <= 1.0`（`PREMIUM_LIMIT = 1.0`、つまり `0%/日` より大きく `100%/日` まで。スラッシュコマンドは `0.001..100.0` %を受け付けて、100 で割ります）。
- 提案者の制限：
  - `100` 口以上を持っていること（`MOTION_MIN_UNITS = 100`、供給量の 1%）。
  - 提案者ごとに、開いている動議は `1` 件まで（`MOTION_MAX_OPEN_PER_USER = 1`）。
  - 提案者の前回の動議から `6` 時間のクールダウン（`MOTION_COOLDOWN_HOURS = 6`）。
  - 別の提案者の動議は、同時に走れます。
  - 提案者は、自動的に `yes` に投票します。
- 投票（`/共済 投票`、または永続の `MotionButton` `kyosai:yes|no:<id>`）：
  - `units > 0` のユーザーなら誰でも、`closes`（`now + 24h`）の前なら投票でき、投票先も変えられます。
  - 票は、**締め切り時点の口の残高で数え直します**（`_tally_for`）。口を譲渡して二重に投票するのを防ぐためです。
- 可決の条件（`motion_passes`、`domain/kyosai.py:62-68`）：
  - `yes_units > no_units`（厳密な過半数。同数は否決）**かつ** `yes_units >= 0.25 * circulating_units`（`circulating = 10,000 - house_units`）。
  - 動議は `(closes, id)` の順に締め切られます。可決した動議は、そのたびに `trust_premium` を上書きします（最後に締め切られたものが勝ち）。

## タイマーとスケジュール
- **1 分のティック（`KyosaiCog.tick`）**：`kyosai_daily`（24 時間ごと）、`kyosai_close_motions`（動議の埋め込みを編集して結果を投稿）、`kyosai_auction_tick`（精算して枠を開き、`sold`／`listed` を投稿）。

## 状態機械
- オークション：`open` → `sold` | `unsold`（`house > 0` なら、すぐに次の `open` を作ります）。
- オファー：`open` → `done` | `cancelled`（`expires` を過ぎたものは無視）。
- 動議：`open` → `passed`（`trust_premium` を更新）| `rejected`。

## ユーザーに表示する日本語文言（原文のまま）
| キー | テンプレート／文字列 | 出典 |
|---|---|---|
| `kyosai.group_name` | `共済`（`🏛️ 帝愛共済（配当と、最後の損の負担・口の競りと譲渡・動議）`） | `cogs/kyosai/cog.py:148` |
| `kyosai.status_title` | `🏛️ 帝愛共済` | `cogs/kyosai/cog.py:72` |
| `kyosai.motion_title` | `🗳️ 帝愛共済の動議 #{id}` | `cogs/kyosai/cog.py:95` |
| `kyosai.motion_result_title` | `🗳️ 帝愛共済の動議の結果` | `cogs/kyosai/cog.py:388` |
| `kyosai.auction_sold_title` | `🔨 帝愛共済の競りの結果` | `cogs/kyosai/cog.py:394` |
| `kyosai.auction_list_title` | `🔨 帝愛共済の口の競り` | `cogs/kyosai/cog.py:399` |
| `kyosai.btn_yes_no` | `👍 賛成` / `👎 反対` | `cogs/kyosai/cog.py:105-106` |
| `kyosai.err_gate` | `いまは口の売買が止まっています（帝愛銀行の準備率が低いか、破産猶予中の人がいます）。` | `cogs/shared/messages/economy.py:64` |
| `kyosai.err_motion_units` | `動議を出せるのは、共済の口を {need:,}口 以上持っている人だけです（いま {have:,}口）。` | `cogs/shared/messages/economy.py:72` |
| `kyosai.err_bad_premium` | `上乗せ金利は 0%/日 より大きく、{max_pct:g}%/日 以下で指定してください。` | `cogs/shared/messages/economy.py:69` |
| `kyosai.ledger_excess` | `共済:超過損失の負担` / `共済:超過損失の負担（借金 {rest:,}ペリカ）` | `infra/db/kyosai.py:132,143` |
| `kyosai.ledger_div` | `共済:配当` | `infra/db/kyosai.py:184` |
| `kyosai.ledger_bid` | `共済:競りの入札（預かり）` / `共済:競りの入札の返金` / `共済:競りの入札の返金（取引停止）` | `infra/db/kyosai.py:91,276,279` |
| `kyosai.ledger_trade` | `共済:口の購入` / `共済:口の売却` | `infra/db/kyosai.py:367,370` |
