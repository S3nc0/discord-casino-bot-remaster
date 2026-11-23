[English](relics.md) | **日本語**

# 発掘品仕様（`relics`）

> 担当：**B2-B** · 画面 ID：`inventory` / `work`（地下労働の UI の中に統合） · 台帳の理由：なし（持ち物のアイテムとして扱い、`market` で取引できます）

## 1. 元ファイル

- `catalogs/relics.yaml`（L1–L25）：バフの率、合成に必要な個数、星の最大段階、6 つの発掘品のバフの対応
- `catalogs/labor.yaml`（L135–L167）：6 つの発掘品の定義、ドロップの確率、参考価値、大きな発見の一覧
- `legacy/python/domain/relics.py`（L1–L65）：ID の解析と整形、バフの集計、`chance_round`
- `legacy/python/infra/db/relics.py`（L1–L70）：`RelicRepo` の持ち物の検索、バフの問い合わせ、合成
- `legacy/python/domain/shop.py`（発掘品のカタログの生成。`docs/spec/shop.ja.md` を参照）
- `legacy/python/cogs/labor/views.py`（L124–L143、L235–L240）：`/地下 作業` の中の発掘品の合成の UI
- `legacy/python/cogs/shared/messages/games.py`（L59–L61）：失敗メッセージ

---

## 2. ルールと正確な数値

### 2.1 入手と保管
- 発掘品は、放置の精算（`domain/labor.py:234-251`）のとき、地下労働のワーカー（`apprentice`、`miner`、`craftsman`。`foreman` は**除く**）が自動で見つけ、ユーザーが **受け取る** を押すと `inventory` に移ります（`infra/db/labor.py:474-479`）。
- 通常のショップでは売っていません（`shop.py` は、持ち物、マーケット、資産評価のためだけに、`category="relic"` のアイテムとして登録します）。
- プレイヤーは、P2P のプレイヤーマーケットで発掘品を取引できます（`docs/spec/player-market.ja.md`）。**エスクロー中・出品中の発掘品はバフが効きません**。`inventory` から外れているためです。

### 2.2 星の段階と合成（`catalogs/relics.yaml:2-4`、`domain/relics.py:11-50`、`infra/db/relics.py:47-69`）
- 星なしの発掘品 1 個あたりの基本のバフ：**`BUFF_RATE = 0.01`**（+1%）。
- 合成の費用：同じ発掘品（同じ `item_id`／星の段階）**`MERGE_COUNT = 10`** 個を合わせて、`star + 1` の発掘品 `1` 個にします。
- 星の最大段階：**`STAR_MAX = 3`**（`★`、`★★`、`★★★`）。
- ID の規則（`domain/relics.py:18-29`）：
  - 星 0：`<base_id>`（例：`relic_fossil`）
  - 星 `n`（`1..3`）：`<base_id>_s<n>`（例：`relic_fossil_s1`、`relic_fossil_s2`、`relic_fossil_s3`）
- 星ごとの効果と参考価値のスケール：`10^star`（`MERGE_COUNT ** star`）：
  - ★0：`+1%`（価値は `1` 倍）
  - ★1（`_s1`）：`+10%`（価値は `10` 倍）
  - ★2（`_s2`）：`+100%`（価値は `100` 倍）
  - ★3（`_s3`）：`+1,000%`（価値は `1,000` 倍）
- 合成しても、バフの合計の強さは変わりません（`10 × +1% = 1 × +10%`）。持ち物がまとまり、1 個あたりの取引価値が上がります。
- 持っているすべての発掘品は、**上限なし**で加算されます（`round(sum, 6)`）。

### 2.3 6 種類の発掘品と、効く場所（`catalogs/relics.yaml:6-24`、`catalogs/labor.yaml:135-166`）

| 基本のアイテム ID | 名前 | アイコン | 基本の価値 | バフのキー | 適用される場所 | 正確な式 |
|---|---|---|---|---|---|---|
| `relic_fossil` | `三葉虫の化石` | `🐚` | `1,500` | `click` | `infra/db/labor.py:380` | `max(1, chance_round(base_pay * (1 + buff)))` |
| `relic_bone` | `恐竜の骨` | `🦴` | `4,000` | `wage` | `domain/labor.py:301,318,343` | `idle_rate * (1 + buff) * hours` |
| `relic_meteor` | `隕石の欠片` | `☄️` | `10,000` | `luck` | `domain/labor.py:319` | `luck = foreman_luck + buff`（鉱石と発掘品のドロップに効く） |
| `relic_vase` | `古代文明の壺` | `🏺` | `25,000` | `recovery` | `domain/labor.py:58` | `fatigue - dt * 0.1 * (1 + buff)` |
| `relic_crown` | `王家の黄金冠` | `👑` | `60,000` | `daily` | `infra/db/wallet.py`（デイリーの受け取り） | `round(base_daily * (1 + buff))` |
| `relic_tear` | `竜の涙` | `🔮` | `100,000` | `prize` | `infra/db/race.py:463-465` | `round(prize * (1 + buff))`（帝愛の賞金のピンハネの前） |

### 2.4 確率的な丸め（`chance_round`、`domain/relics.py:60-64`）
- `click` のバフに使います。`10` ペリカのクリックに `+1%` のような小さなボーナス（`10.1`）が付いても、平均すると正確になります：
  `int(x) + (1 if rng.random() < (x - int(x)) else 0)`。

---

## 3. エッジケース

- 合成は、DB のトランザクションの中でアトミックに行われます：`qty >= 10` の行の `qty` を `10` 減らし、`<base>_s<star+1>` を `+1` で upsert します。
- `relic_merge` は、発掘品でないアイテム（`relic_not_relic`）、星が `>= 3`（`relic_max_star`）、出品していない在庫が足りないとき（`relic_need_more`）を拒否します。
- バフに効くのは、`inventory` のうち `item_id LIKE 'relic_%'` で `qty > 0` のアイテムだけです（`infra/db/relics.py:21-28`）。
- `LaborView` の合成のドロップダウンは、合成できる発掘品（`qty >= 10` かつ `star < 3`）が 1 つ以上あるときだけ出ます。参考価値の高い順に並べ、Discord のセレクトの上限 25 件で切ります（`cogs/labor/views.py:124-143`）。

---

## 4. 日本語文言（原文のまま）

| キー ID | 日本語文言（原文） | 出典 |
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
