[English](INDEX.md) | **日本語**

# 旧仕様インデックス

旧ボットの各モジュールを、挙動仕様、決定論的なパリティ用フィクスチャのディレクトリ、移植の担当に対応づけたマスター索引です。

> **元のコードの場所。** 元の Python ボットは v1.0.0 でツリーから削除し、git 履歴にだけ残っています。これらの仕様にある `.py` のパス（`domain/…`、`infra/…`、`services/…`、`cogs/…`、`manage.py`）は、すべてそのボットのフォルダからの相対パスで、行番号も当時のものです。読むには：`git show "$(git log --diff-filter=D --format=%H -1 -- legacy/python)^:legacy/python/domain/horse.py"`。ここにあるルールと数値はリマスターが実装しているもので、リマスターが違う場合は仕様にそう書いてあります。

- **B2-A**：カジノゲーム（`chinchiro`、`pachinko`、`slots`、`blackjack`、`roulette`、および共通の `casino-common`）。
- **B2-B**：カジノ以外のゲーム、育成、ソーシャルゲーム、ショップ、経済の中核（`horse`、`arena`、`labor`、`relics`、`quiz`、`lottery`、`polls`、`shop`、`missions`、`weekly-ranking`、`daily`、`transfer`、`economy-core`、`admin`）。
- **B3**：金融、証券、銀行、信用、共済、会社、プレイヤーマーケット（`stocks`、`crypto`、`teiai`、`p2p-loans`、`kyosai`、`player-market`、`companies`）。

## 参考文書

- [glossary.ja.md](glossary.ja.md) — 英語・日本語の用語対応表。
- [parity-fixtures.ja.md](parity-fixtures.ja.md) — フィクスチャの生成コマンド、`FrozenClock` とシードによる決定論のルール、JSON の形式、旧 pytest の件数（`1354 passed, 1 skipped`）、フィクスチャでは再現できない部分。

## モジュール一覧

| モジュール | 仕様ファイル | フィクスチャ | 担当 | メモ |
| --- | --- | --- | --- | --- |
| カジノ共通（RTP レベル、ジャックポット、イベント、エスクロー） | [casino-common.ja.md](casino-common.ja.md) | `tests/fixtures/legacy/casino-common/` | B2-A | 5 つのカジノゲーム全部で使う共通処理。 |
| チンチロ | [chinchiro.ja.md](chinchiro.ja.md) | `tests/fixtures/legacy/chinchiro/` | B2-A | 親と戦う 3 つ振りのサイコロゲーム（`pinzoro`〜`hifumi`）。 |
| パチンコ | [pachinko.ja.md](pachinko.ja.md) | `tests/fixtures/legacy/pachinko/` | B2-A | 予兆、ティア、ラウンド倍率を持つ複数スピンのセット台。 |
| スロット | [slots.ja.md](slots.ja.md) | `tests/fixtures/legacy/slots/` | B2-A | 重み付き 3 リールのスロット。 |
| ブラックジャック | [blackjack.ja.md](blackjack.ja.md) | `tests/fixtures/legacy/blackjack/` | B2-A | ヒット、スタンド、ダブルダウンのある標準的な 21。 |
| ルーレット | [roulette.ja.md](roulette.ja.md) | `tests/fixtures/legacy/roulette/` | B2-A | ゼロが 1 つのヨーロピアン式ホイール（`0`〜`36`）。 |
| 競馬（賭け、引退、1 日 4 レース） | [horse.ja.md](horse.ja.md) | `tests/fixtures/legacy/horse/` | B2-B | 所有、能力のにんじん、7 種類の賭け式、引退、JST 1 日 4 レースを扱います。**注**：馬の配合は旧 Python には存在しません。 |
| 馬の配合（新規、旧仕様なし） | [horse-breeding.ja.md](horse-breeding.ja.md) | *（なし。新機能なのでプロパティテストで検証）* | B2-B | 2026-11-21 承認：自分の馬どうしの配合、`15,000` の配合費はシンク、仔馬の能力は平均に回帰して合計上限は `210`、成熟まで 48 時間、クールダウン 72 時間。 |
| 闘技場（毎日の NPC トーナメント） | [arena.ja.md](arena.ja.md) | `tests/fixtures/legacy/arena/` | B2-B | 毎日の `duel` と `royale` の NPC トーナメント表。武器ボーナスとプールの補填があります。 |
| 地下労働（クリッカー／ワーカー） | [labor.ja.md](labor.ja.md) | `tests/fixtures/legacy/labor/` | B2-B | 手動採掘、疲労、道具と寮の強化、放置ワーカー、ボット対策、帝愛の `3%` ピンハネ。 |
| 発掘品 | [relics.ja.md](relics.ja.md) | `tests/fixtures/legacy/relics/` | B2-B | 発掘ドロップ、10 個で 1 つ上の星に上がる合成（`★1`〜`★5`）、常時バフの重ね掛け。 |
| クイズ | [quiz.ja.md](quiz.ja.md) | `tests/fixtures/legacy/quiz/` | B2-B | ユーザー作成のクイズ、正解率と参加者数による報酬の式、一括インポート。 |
| 抽選会 | [lottery.ja.md](lottery.ja.md) | `tests/fixtures/legacy/lottery/` | B2-B | サーバー単位のチケットプールによる抽選。当選者は 1 人、全額返金の中止もあります。 |
| 投票 | [polls.ja.md](polls.ja.md) | `tests/fixtures/legacy/polls/` | B2-B | 期限つきのはい／いいえ投票。有料の隠し票操作（帝愛銀行へ `500` ペリカ）。 |
| ショップ（カタログ、帝愛オークション、闇市） | [shop.ja.md](shop.ja.md) | `tests/fixtures/legacy/shop/` | B2-B | 公式カタログ、時間による補充、押収オークションの値下がり、毎日の帝愛闇市。 |
| ミッション | [missions.ja.md](missions.ja.md) | `tests/fixtures/legacy/missions/` | B2-B | 決定論的な毎日のミッション一覧、進捗フック、報酬の受け取り。 |
| 週間ランキングの称号 | [weekly-ranking.ja.md](weekly-ranking.ja.md) | `tests/fixtures/legacy/weekly-ranking/` | B2-B | 週間の純利益ランキング（`min_plays = 5`）と週間王者の称号。 |
| デイリー（ストリークあり、JST 6 時間リセット） | [daily.ja.md](daily.ja.md) | `tests/fixtures/legacy/daily/` | B2-B | JST 1 日 4 枠、ストリークによる増額、`daily_double`／`streak_guard`／`relic_crown`、債務者のピンハネと天引き。 |
| 送金（手数料 `10%`、1 日の上限、`3` ゲーム以上） | [transfer.ja.md](transfer.ja.md) | `tests/fixtures/legacy/transfer/` | B2-B | 上限 `10%` の手数料、1 日の元本上限 `20,000`、`3` ゲーム以上の条件、債務者のブロックと受取側の天引き。 |
| 経済の中核（サーバー別経済、初期残高 `3,000`） | [economy-core.ja.md](economy-core.ja.md) | `tests/fixtures/legacy/economy-core/` | B2-B | **サーバー別経済**と**初期残高 3,000**に、台帳、下限の切り上げ、履歴のまとめ方、貸借対照表（純資産・流動資産）、プレイヤーの状態を合わせて扱います。 |
| 管理コマンド | [admin.ja.md](admin.ja.md) | *（なし。[parity-fixtures.ja.md](parity-fixtures.ja.md) を参照）* | B2-B | Discord の権限、モデレーション、サーバー承認の流れは固定入力では再現できません。根本の変更処理は `economy-core` と `casino-common` で検証します。 |
| 株式（4 銘柄、信用取引、オプション、債券、1 分ティック） | [stocks.ja.md](stocks.ja.md) | `tests/fixtures/legacy/stocks/` | B3 | 相関つきのコレスキー分解ティック、±30% の値幅制限、譲渡益課税、クロスマージン、Black-Scholes と Margrabe のオプション、決算、イベント、CIR の `r_f`、債券。 |
| 暗号資産（`CSトークン`） | [crypto.ja.md](crypto.ja.md) | `tests/fixtures/legacy/crypto/` | B3 | 旧版では `/証券` に統合済み（`cs` 銘柄、`CryptoRepo` のミリ単位の現物保有と担保ロック）。市場のティックと信用取引は [stocks.ja.md](stocks.ja.md) も参照。 |
| 帝愛銀行（準備率、破産猶予、破綻保証、信託） | [teiai.ja.md](teiai.ja.md) | `tests/fixtures/legacy/teiai/` | B3 | 部分準備、サーモスタット、信託預金、トイチの債務、`15,000` の破産猶予、強制執行、海外逃亡、破綻保証。 |
| 個人間融資 | [p2p-loans.ja.md](p2p-loans.ja.md) | `tests/fixtures/legacy/p2p-loans/` | B3 | わかりやすさのため帝愛銀行から分割。プレイヤー間の貸出オファー、単利、延滞ペナルティ、満期の自動回収、差し押さえ。 |
| 帝愛共済 | [kyosai.ja.md](kyosai.ja.md) | `tests/fixtures/legacy/kyosai/` | B3 | わかりやすさのため帝愛銀行から分割。口のオークション、ハミルトン方式の配当、超過損失の徴収、口のプレイヤー間譲渡（手数料 `5%`）、ガバナンス動議。 |
| プレイヤーマーケット／オークション／エスクロー | [player-market.ja.md](player-market.ja.md) | `tests/fixtures/legacy/player-market/` | B3 | 固定価格と期限つきオークションの出品（手数料 `5%`、スナイプ対策、猶予期間内の取り下げ）。ゲームの賭け金のエスクローは [casino-common.ja.md](casino-common.ja.md) にあります。 |
| 会社 | [companies.ja.md](companies.ja.md) | `tests/fixtures/legacy/companies/` | B3 | 決定論的な毎日の市況、連続生産、予算で頭打ちになる売上、外部の出資、配当、維持費 3 日未払いによる破産。 |
| 配信パネル（新規、上流の取り込み） | [stream.ja.md](stream.ja.md) | *（なし。新機能のため、代わりにプロパティテスト）* | S0 | 配信者のパネルで、スパチャ（送金のルール）と勝ち・負けの山分けの賭け（控除 `5%`、1 人 1 勝負 `10,000` まで）を受ける。2026-11-24 のオーナーの決定：勝ち・負けは締切のあとだけ、賭けは 10 分で自動で締切、`/admin stream-void` と監査ログ、ボイスチャンネルは自動で作らない。 |

## 統合・分割したモジュールのメモ

- **サーバー別経済**と**初期残高 3,000**は、同じ `AccountCore` / `WalletRepo` の初期化経路と `users` テーブルのスキーマを共有するため、[economy-core.ja.md](economy-core.ja.md) にまとめました。
- **帝愛銀行**のサブシステムである**個人間融資**（[p2p-loans.ja.md](p2p-loans.ja.md)）と**帝愛共済**（[kyosai.ja.md](kyosai.ja.md)）は、それぞれ独立したドメインモジュール、データベーススキーマ、状態機械を持つため、[teiai.ja.md](teiai.ja.md) と並べて専用の仕様ファイルとフィクスチャのディレクトリを用意しました。
- **馬の配合**は、元の Python ボットのどこにも存在しません。[horse.ja.md](horse.ja.md) に存在しないことを明記し、リマスター独自の設計は [horse-breeding.ja.md](horse-breeding.ja.md) にあります。
- **暗号資産**（`/暗号`）は、旧版で `/証券` に統合されました（`cs` = `CSトークン`）。[crypto.ja.md](crypto.ja.md) が `CryptoRepo` の現物台帳を扱い、市場のティックと信用取引は [stocks.ja.md](stocks.ja.md) を参照します。
- **カジノ共通**（[casino-common.ja.md](casino-common.ja.md)）は、RTP レベル、ジャックポット、ボーナスイベント、エスクローのルールを 1 か所にまとめ、5 つのカジノ仕様で重複しないようにしています。
