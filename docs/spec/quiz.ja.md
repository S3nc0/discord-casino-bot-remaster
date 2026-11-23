[English](quiz.md) | **日本語**

# クイズ仕様（`quiz`）

> 担当：**B2-B** · 画面 ID：`quiz` · 台帳の理由：`quiz_reward`、`quiz_author_pay`、`quiz_author_reward`

## 1. 元ファイル

- `catalogs/economy.yaml`（L32–L52）：`quizpay` の定数と、文字数の上限
- `legacy/python/domain/quizpay.py`（L1–L58）：出題者への支払いの計算（`factor`、`scale`、`base_reward`、`bonus`、`participation`、`author_payout`）
- `legacy/python/domain/quizimport.py`（L1–L167）：一括インポートのテキストの解析（`parse_bulk`）
- `legacy/python/domain/duration.py`（L1–L34）：日本語の期間の解析と整形（`parse_duration`、`format_minutes`）
- `legacy/python/infra/db/quiz.py`（L1–L329）：`QuizRepo` の CRUD、回答、リアルタイムの出題者への支払いの調整、債務への切り替え、取り下げ、精算
- `legacy/python/services/quiz.py`（L1–L70）：`QuizService` のファサード
- `legacy/python/cogs/quiz/cog.py`（L1–L280）：`/クイズ 挑戦|出題|取り下げ`、1 分間隔の精算ループ、管理者による一斉の告知
- `legacy/python/cogs/quiz/embeds.py`（L1–L149）：選択肢・用語・判定の検証、問題・結果・公開・精算の埋め込み
- `legacy/python/cogs/quiz/views.py`（L1–L290）：`PublicButton`（動的で永続）、`AnswerView`、`AddModal`、`UserModal`
- `legacy/python/cogs/quiz/texts.py`（L1–L5）：既定の判定のラベル
- `legacy/python/cogs/shared/messages/games.py`（L72–L83）：失敗メッセージ

---

## 2. 2 つのクイズのモードと上限

| 項目 | 管理者／公式のクイズ（`author_id = 0`） | ユーザーが作ったクイズ（`author_id > 0`） |
|---|---|---|
| 範囲 | 全サーバー共通（`guild_id = 0`） | サーバー単位（`guild_id = 出題者のサーバー`） |
| 報酬の出どころ | システムが新たに作り出す | 出題者のウォレットから払う。足りない分は `owe_for` で帝愛の債務になる（`infra/db/quiz.py:165-168`） |
| 期間 | 任意（`1 分`〜`365 日`、または無期限の `None`） | 必須（`1 分`〜`10,080 分`（7 日）、既定は `4,320 分`（3 日）） |
| 報酬の上限 | `>= 1`（上限なし、既定は `100`） | `>= 1`（上限なし。出題時に出題者の `balance >= reward` が必要で、債務がないこと） |
| 出題者の資格 | Bot のオーナー／管理者 | `debt == 0`、開いているクイズが `< 2`（`OPEN_LIMIT = 2`）、直近 24 時間の出題が `< 3`（`DAILY_LIMIT = 3`） |
| 回答者の資格 | 誰でも（1 サーバー・1 クイズにつき 1 回） | 同じサーバーで、`user_id != author_id`、1 クイズにつき 1 回。**報酬と出題者の集計の条件**：`games_played >= 3`（`MIN_GAMES_FOR_REWARD = 3`） |
| 出題者への支払い | なし | 資格のある回答のたびに、システムが出題者へ動的に払い、期限切れ・取り下げのときに確定する |

### 入力の上限（`catalogs/economy.yaml:45-52`）
- 選択肢：空でなく重複しない行がちょうど **4** つ（`choices[0]` が正解）。`shown_order` にシャッフルして保存します（`LETTERS = "ABCD"`）。
- `MAX_QUESTION_LEN = 500`、`MAX_CHOICE_LEN = 80`、`MAX_EXPLANATION_LEN = 800`、`MAX_VERDICT_LEN = 20`。
- 一括インポート（`domain/quizimport.py`）：`---` で区切り、コメントは `#`、最大 **`MAX_QUESTIONS = 30`** 問。ファイル内、または DB との間で問題が重複していれば拒否し、全部受け付けるか、全部受け付けないかです。

---

## 3. 出題者への支払いの式（`domain/quizpay.py:14-57`）

`n` ＝ 資格のある（`counted=1`、つまり `games_played >= 3`）回答者の数、`c` ＝ 資格のある正解の数、`r` ＝ 正解 1 人あたりのクイズの報酬とします：

- `n < 2`（`MIN_PARTICIPANTS = 2`）なら、出題者は `(0, 0, 0)` を受け取ります。
- そうでなければ：
  - 正答率の近さの係数 `f(n, c) = max(0.0, 1 - |c/n - 0.40| / 0.40)`（`TARGET_RATE = 0.40`。正答率 40% で `1.0`、0% または 80% 以上で直線的に `0.0` まで下がります）。
  - 報酬のスケール `m(r) = sqrt(max(r, 0) / 100)`（`REWARD_SCALE_BASE = 100`）。
  - `base = round(100 * m(r))`（`BASE_REWARD = 100`）
  - `bonus = round(200 * f(n, c) * m(r))`（`MAX_BONUS = 200`）
  - `participation = round(f(n, c) * 1.0 * r * n)`（`PARTICIPATION_RATE = 1.0`）
  - `entitled = base + bonus + participation`。

### リアルタイムの差分での精算（`infra/db/quiz.py:193-214`）
- 資格のある回答のたびに、`diff = entitled - quiz.earned` をすぐに精算します：
  - `diff > 0`：出題者に入金します（`クイズ出題報酬`、`income=diff`）。
  - `diff < 0`：出題者の残高の範囲で取り戻します（`クイズ出題報酬（調整）`）。`quiz.earned` は、実際の純額 `earned + moved` を追います。
- 期限切れ（1 分間隔のバックグラウンドのティック）または `/クイズ 取り下げ` のとき：最後の `_quiz_pay_author` を実行し、`settled = 1` にし、元の投稿のタイトルを `📰 【終了】...` に編集して `view=None` にし、出題者にメンションして、正解者と不正解者を並べた結果の埋め込みを投稿します。

---

## 4. 期間の解析（`domain/duration.py:6-33`）

- NFKC で正規化し、カンマを取り除きます。単位：`日`/`d` ＝ `1440m`、`時間`/`時`/`h` ＝ `60m`、`分`/`m` ＝ `1m`。
- 数字だけのときは `default_unit`（既定は `"時間"`）を使います。単位の重複や、余ったテキストは拒否します。

---

## 5. エッジケース

- ユーザーが作ったクイズに答えた人の `games_played < 3` のとき：回答は記録され（`counted = 0`）、正誤は表示されますが、報酬は払われず（`reward_blocked = True`）、出題者にも課金されず、その回答は出題者への支払いの `n`／`c` に数えられません（`infra/db/quiz.py:157-185`）。
- 資格のある人が正解したとき、出題者のウォレットが `reward` をまかなえない場合：ウォレットを 0 まで使い、残りは `debt.owe_for(gid, author, shortfall, "クイズの報酬の支払い")`（強制清算や破産の債務の作成が走ります）を通り、回答者は、それでも `reward` を全額受け取ります。
- `/クイズ 挑戦` は、`author_id=0 OR (guild_id=gid AND author_id!=uid)` に合う、まだ答えておらず期限の切れていないクイズのうち、いちばん古いもの（`ORDER BY q.id`）を選びます。

---

## 6. 日本語文言（原文のまま）

| キー ID | 日本語文言（原文） | 出典 |
|---|---|---|
| `quiz.cmd.group_desc` | `📰 時事ネタ・豆知識の4択に答えて、正解でペリカをもらう` | `cogs/quiz/cog.py:195` |
| `quiz.cmd.play_desc` | `クイズに挑戦する（正解でペリカがもらえる）` | `cogs/quiz/cog.py:197` |
| `quiz.cmd.post_desc` | `自分のクイズを出す（報酬は自分のペリカから払う）` | `cogs/quiz/cog.py:211` |
| `quiz.cmd.withdraw_desc` | `自分が出したクイズを終わらせる` | `cogs/quiz/cog.py:215` |
| `quiz.verdict.default_right` | `正解！` | `cogs/quiz/texts.py:3` |
| `quiz.verdict.default_wrong` | `不正解…` | `cogs/quiz/texts.py:4` |
| `quiz.play.none` | `いま挑戦できる問題はありません。新しい問題を待ってください。` | `cogs/quiz/cog.py:202` |
| `quiz.play.footer` | `正解で {reward:,}ペリカ ｜ 1問1回だけ ｜ あと{remaining}問` | `cogs/quiz/embeds.py:84` |
| `quiz.result.blocked` | `**報酬はありません**（ゲームを{min_games}回以上遊ぶと、みんなの問題の報酬をもらえます）` | `cogs/quiz/embeds.py:92` |
| `quiz.result.wrong` | `正解は **{answer}** でした。` | `cogs/quiz/embeds.py:98` |
| `quiz.public.author_note` | `（出題者は答えられません。正解の報酬は出題者が払います）` | `cogs/quiz/embeds.py:109` |
| `quiz.public.footer` | `下のボタンで答える。正解で {reward:,}ペリカ ｜ 1人1回だけ` | `cogs/quiz/embeds.py:114` |
| `quiz.settle.too_few` | `回答者が{min_p}人に満たなかった（{n}人）ので、出題報酬はありません。` | `cogs/quiz/embeds.py:136` |
| `quiz.settle.summary` | `参加 **{n}人** ／ 正解 **{c}人**（正答率 **{rate:.0%}**）\n出題報酬: 基本 {base} ＋ 正答率ボーナス {bonus} ＋ 参加報酬 {part} ＝ **{total}**（回答のたびに受け取り済み）\n（正答率{target:.0%}に近いほど、ボーナスと参加報酬が大きくなります）` | `cogs/quiz/embeds.py:138-140` |
| `quiz.public.debt_warn` | `⚠️ 出題者 <@{author_id}> の残高が足りないため、不足 {debt} は出題者の借金になりました。` | `cogs/quiz/views.py:63-64` |
| `quiz.err.ended` | `この問題は終了しました。` | `cogs/shared/messages/games.py:73` |
| `quiz.err.wrong_guild` | `この問題は、出題されたサーバーでだけ答えられます。` | `cogs/shared/messages/games.py:74` |
| `quiz.err.self_answer` | `自分が出した問題には答えられません。` | `cogs/shared/messages/games.py:75` |
| `quiz.err.already_answered` | `この問題にはもう答えています。` | `cogs/shared/messages/games.py:76` |
| `quiz.err.open_limit` | `` 同時に出せる問題は {limit} つまでです。`/クイズ 取り下げ` で下げてから出してください。 `` | `cogs/shared/messages/games.py:78` |
| `quiz.err.daily_limit` | `出題は、24時間に {limit} 問までです。` | `cogs/shared/messages/games.py:80` |
| `quiz.err.insufficient_balance` | `残高が報酬（{reward:,}ペリカ）に足りません。出題するには、正解1人ぶんの報酬が残高に必要です。` | `cogs/shared/messages/games.py:82` |
| `quiz.ledger.reward` | `クイズ報酬` | `infra/db/quiz.py:170` |
| `quiz.ledger.author_pay` | `クイズ報酬の支払い` | `infra/db/quiz.py:166` |
| `quiz.ledger.author_reward` | `クイズ出題報酬` / `クイズ出題報酬（調整）` | `infra/db/quiz.py:206,210` |
