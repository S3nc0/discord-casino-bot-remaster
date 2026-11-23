[English](parity-fixtures.md) | **日本語**

# 旧版との一致確認用フィクスチャ

この文書は、元の Python ボット（v1.0.0 より前の git 履歴を参照）から決定論的な一致確認用フィクスチャを生成する方法、JSON の構成、バイト単位で再現できることの確認方法、そして固定の入力では再現できない旧版の機能を説明します。

## 再生成のコマンド

フィクスチャはコミット済みのデータで、リマスターのテストはそれを読むだけなので、生成スクリプトは要りません。作り直すときは、実行のあいだだけ元のボットを git 履歴から `legacy/python/` に戻し、リポジトリのルートから、同期した `uv` 環境で実行し、そのあと削除します。

```sh
git restore --source="$(git log --diff-filter=D --format=%H -1 -- legacy/python)^" -- legacy/python
uv --directory legacy/python run python ../../tests/fixtures/legacy/generate/generate.py
rm -rf legacy/python   # コミットし直さないこと
```

生成スクリプトは、`tests/fixtures/legacy/<module>/<file>.json` に 26 個の JSON ファイルを書き出します。

## 起動と決定論のルール

1. **元のボットには一切手を入れません**：
   その `infra/paths.py` の既定はボット自身の `catalogs/` フォルダですが、実際の YAML のカタログは `<repo_root>/catalogs` にあります。`generate.py` は、`domain.*` や `infra.db.*` を import する前に、`infra.paths.CATALOGS_DIR`、`infra.catalogs.loader.CATALOG_DIR`、`infra.catalogs.CATALOG_DIR` をメモリ上でパッチし、`infra.catalogs.bind_catalogs()` を呼びます。
2. **固定の時計（`FrozenClock`）**：
   リポジトリのテストはすべて、`open_repositories(":memory:", strict=True, clock=FrozenClock(BASE_DT))` を使い、`2025-01-06 09:00:00+09:00`（`BASE_TS = 1736121600.0`、月曜日、JST の `UTC+9`）を基準にします。時間は、`clock.set_ts(...)` と、明示的な `now` 引数でだけ進めます。
3. **固定の PRNG のシード**：
   乱数を使う関数には、それぞれ独立した `random.Random(<seed>)` を渡します（シードは、B2-A が `1001`〜`1007`、B2-B が `2001`〜`2015`、B3 が `3001`〜`3004`）。`LaborRepo.labor_collect` は、内部の `domain.labor.settle_plan(..., rng=None)` が `random.SystemRandom()` に切り替わるため、`generate.py` は、その呼び出しのあいだだけ `domain.labor.random.SystemRandom` を `random.Random(20110)` に置き換えるパッチを当て、`finally` ブロックで元に戻します。
4. **正規化した JSON の書き出し**：
   すべての出力ファイルは `json.dumps(serialize(payload), ensure_ascii=False, indent=2, sort_keys=True) + "\n"` で書きます。float は小数 10 桁に丸め、データクラス、セット、日付、SQLite の行は決まった方法で変換します。

## バイト単位での再現性の確認

生成を 2 回走らせて SHA-256 のダイジェストを比べると、隠れたエントロピーや実時間の漏れがないことを確認できます。

```sh
H1=$(find tests/fixtures/legacy -type f -name '*.json' | sort | xargs shasum -a 256)
uv --directory legacy/python run python ../../tests/fixtures/legacy/generate/generate.py >/dev/null
H2=$(find tests/fixtures/legacy -type f -name '*.json' | sort | xargs shasum -a 256)
test "$H1" = "$H2" && echo "BYTE-FOR-BYTE IDENTICAL"
```

確認した結果：連続した実行で、**26/26 個の JSON ファイルがバイト単位で一致**しました。

## 旧版のテスト件数の基準

元のボットの Python のテストスイートを（同じメモリ上のカタログのパスのパッチで、ボットには手を入れずに）走らせた結果：

- **結果**：`1354 passed, 1 skipped, 8 warnings in 27.00s`

## フィクスチャの形式の概要

どの JSON ファイルも、トップレベルに文字列の `"module"` と、任意の `"seed"` / `"seeds"` のメタデータを持ち、そのあとに、純粋なドメインの入出力のベクトルと、（該当する場合は）合成したスノーフレーク（`GUILD_A = 100000000000000001`、`GUILD_B = 100000000000000002`、`USER_1..3 = 200000000000000001..3`）を使った、リポジトリの状態遷移の通しの `"db_flow"` が続きます。

| モジュール | フィクスチャのファイル | 対象とする入力と出力 |
| --- | --- | --- |
| `casino-common` | `tests/fixtures/legacy/casino-common/formulas.json` | ジャックポットの確率・積み立て・抽選、5 つのカジノゲーム全部の RTP レベル `1`〜`6`、毎日のイベントのスケジュール、有効な時間帯、ボーナスの支払いの計算。 |
| `chinchiro` | `tests/fixtures/legacy/chinchiro/hands.json` | すべての役の分類、配当つきの 9 通りの総当たりの勝負、シード固定の、プレイヤー対親の複数回振りの 15 ラウンド。 |
| `pachinko` | `tests/fixtures/legacy/pachinko/spins.json` | 理論上の当選率（全体、予兆別、ティア別）、RTP、シード固定の 30 スピン、8 セット、15 回のラウンドの抽選。 |
| `slots` | `tests/fixtures/legacy/slots/spins.json` | 理論上の RTP、8 通りの明示的なリールの組み合わせ、倍率とラベルつきの、シード固定の 40 回のリールのスピン。 |
| `blackjack` | `tests/fixtures/legacy/blackjack/hands.json` | ソフト／ハードの手札の評価、ナチュラルブラックジャックの判定、配当の全表、シード固定のヒット／スタンドの 10 ゲームと、ダブルダウンの 1 ゲーム。 |
| `roulette` | `tests/fixtures/legacy/roulette/spins.json` | 色の対応（`0`〜`36`）、賭けの種類ごとの RTP、11 種類の賭け方 × 6 通りの出目の勝敗と配当の表、シード固定の 30 スピン。 |
| `horse` | `tests/fixtures/legacy/horse/races.json` | 毎日 4 レースのスケジュール、シード固定のコースと 8 頭、オッズ、シミュレーション全体、7 種類の賭け式のすべての確認、引退の価値、能力の操作、DB での馬の作成・登録・オッズ・賭け・レースの実行。 |
| `arena` | `tests/fixtures/legacy/arena/tournaments.json` | `duel` と `royale` の戦士の生成、オッズ、武器ボーナス、配当の調整と補填の上限、試合のシミュレーション、DB でのトーナメントの賭け → 準決勝 → 決勝の流れ。 |
| `labor` | `tests/fixtures/legacy/labor/work.json` | つるはし・手袋・寮の費用、クリックの結果、疲労の減衰、地形、放置の賃金率、6 時間の `settle_plan`、マクロ対策の検出（`mechanical` 対 `normal`）、DB でのクリック・強化・雇用・4 時間後の受け取り。 |
| `relics` | `tests/fixtures/legacy/relics/buffs.json` | 発掘品の ID と星の解析、複数の発掘品のバフの重ね掛け、`chance_round` の並び、DB での 10 個を 1 つにする `relic_merge`（`relic_fossil` → `relic_fossil_s1`）。 |
| `quiz` | `tests/fixtures/legacy/quiz/rewards.json` | 解答者の基本報酬、正解率の係数、ボーナス、参加、6 つのケースにわたる作者への支払い、`parse_bulk` の解析。 |
| `lottery` | `tests/fixtures/legacy/lottery/draws.json` | DB での抽選会の開催、複数ユーザーの参加、重複参加の拒否、シード固定の当選者の抽選、返金つきの中止の流れ。 |
| `polls` | `tests/fixtures/legacy/polls/outcomes.json` | `shown(real, adj)` の頭打ちと、DB での投票の作成、投票、有料の票操作、予定どおりの締め切り。 |
| `shop` | `tests/fixtures/legacy/shop/purchases.json` | 補充の在庫の計算、帝愛の押収オークションの値下がり（`0`〜`72h`）、帝愛の闇市の毎日の計画と価格の値下がり、DB でのショップとオークションの購入。 |
| `missions` | `tests/fixtures/legacy/missions/progress.json` | 連続する 2 日分の、決定論的な毎日のミッションの選択、ジャックポットの閾値の確認、DB でのプレイの進捗とミッションの受け取り状況。 |
| `weekly-ranking` | `tests/fixtures/legacy/weekly-ranking/titles.json` | ISO 週の補助関数、`min_plays = 5` の資格のフィルター、週間のリーダーボードのランキング、週間王者の報酬の精算。 |
| `daily` | `tests/fixtures/legacy/daily/claims.json` | JST の 6 時間の枠ごとのストリークの進み方、同じ枠の重複の拒否、`daily_double` の消費、債務者への `20%` のピンハネと `30%` の天引き。 |
| `transfer` | `tests/fixtures/legacy/transfer/transfers.json` | `min_games = 3` のブロック、`10%` の上限つきの手数料（`1005 → 101`）、債務者の受取側への `30%` の天引き、1 日の元本の上限 `20,000`、債務者の送金者のブロック。 |
| `economy-core` | `tests/fixtures/legacy/economy-core/core.json` | サーバー別の分離（`GUILD_A` 対 `GUILD_B`）、初期残高 `3,000`、ゼロの下限の切り上げ、履歴のまとめ、15 項目の資産の貸借対照表。 |
| `stocks` | `tests/fixtures/legacy/stocks/market.json` | 共分散とコレスキー分解の `L`、シード固定の 1 分ティック 10 回、±30% の値幅制限とピンの状態、累進の譲渡益課税、信用取引の式、Black-Scholes と Margrabe のオプション、決算のジャンプとメモ、ボラティリティのイベント、CIR の `r_f` の 1 ステップ、債券の値付けと債務不履行リスク。 |
| `crypto` | `tests/fixtures/legacy/crypto/spot.json` | `buy_quote`、`sell_quote`、ミリ単位の平均取得単価、DB での複数回の買いと、譲渡益課税つきの一部売り。 |
| `teiai` | `tests/fixtures/legacy/teiai/bank_debt.json` | ピンハネ・天引き・破綻保証のオッズの計算、サーモスタットの流入・ショック・減衰、DB での信託預金・利息の加算・引き出し、種銭の借り入れ、破綻保証の購入、3 日間のトイチの利息、海外逃亡、破綻保証の支払いつきの強制破産。 |
| `p2p-loans` | `tests/fixtures/legacy/p2p-loans/loans.json` | 日割りの単利、延滞ペナルティ（`max(1.5x, 2%/day)`、上限 `2x`）、DB でのオファー → 承諾 → 一部返済 → 満期の自動回収。 |
| `kyosai` | `tests/fixtures/legacy/kyosai/operations.json` | ハミルトン方式の `split`、`dividend_pool`、流動性の `gate_locked`、`motion_passes`、DB でのオークションの開催・入札・精算と、手数料 `5%` の口の P2P 譲渡。 |
| `player-market` | `tests/fixtures/legacy/player-market/listings.json` | `tradable`、手数料 `5%`、価格の範囲、`min_next_bid`、スナイプ対策の `end_after_bid`、DB での固定価格の購入と、6 時間のオークションの入札・競り負け・精算。 |
| `companies` | `tests/fixtures/legacy/companies/operations.json` | 生産量・倉庫・維持費・増築・出資の上限の式、決定論的な `day_state`、12 時間の連続の `produce`、全額と予算で頭打ちの `sale`、`dividend_split`、`stake_values`、DB での設立・出資・持分・配当・出荷・精算の流れ。 |

## 固定の入力では再現できないモジュールと側面

次の旧版のモジュールや挙動は、実際の Discord のゲートウェイや HTTP のやり取り、または実時間のイベントループに依存するため、決定論的な JSON フィクスチャは**ありません**。

1. **`admin`（`docs/spec/admin.ja.md`）**：
   サーバーの承認の流れ、スラッシュコマンドの権限のゲート（`manage_guild`／Bot のオーナーの確認）、Discord のチャンネルの紐づけ、機能フラグの UI の切り替え、運営者への監査メッセージは、いずれもリポジトリ呼び出しを包む薄い Discord の cog で、その中身は、`economy-core`、`casino-common`、`teiai` で、すでに検証しています。
2. **Discord の UI、リッチな表示、ゲートウェイの副作用**：
   対話型の Discord のビュー・ボタン・モーダル、ビューのタイムアウト、ユーザーごとのコマンドのクールダウン、ライブチャートのメッセージの編集（`swap_chart_post`）、Discord のニックネームの称号の同期（`domain/nick.py` は純粋な文字列のルールを適用しますが、Discord API の `member.edit(nick=...)` やロールの色の同期は、実際のサーバーとメンバーの状態に依存します）、DM とチャンネルへの告知の配信。
3. **バックグラウンドのスケジューラーのループのタイミング**：
   `discord.ext.tasks` のポーリング間隔（1 分の株のティックのループ、予定されたレースの告知、1 時間ごとの信託の利息の加算、毎日の会社の維持費の一括処理）は、実時間のタイマーで待つ代わりに、明示的な `FrozenClock` の時刻で、基になるリポジトリのティックのメソッドを直接呼ぶことで、フィクスチャに表現しています。
