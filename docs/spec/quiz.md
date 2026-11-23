**English** | [日本語](quiz.ja.md)

# Quiz Specification (`quiz`)

> Planned Owner: **B2-B** · Screen ID: `quiz` · Ledger Reasons: `quiz_reward`, `quiz_author_pay`, `quiz_author_reward`

## 1. Source Files

- `catalogs/economy.yaml` (L32–L52): `quizpay` constants & text limits
- `legacy/python/domain/quizpay.py` (L1–L58): author payout math (`factor`, `scale`, `base_reward`, `bonus`, `participation`, `author_payout`)
- `legacy/python/domain/quizimport.py` (L1–L167): bulk text import parser (`parse_bulk`)
- `legacy/python/domain/duration.py` (L1–L34): Japanese duration parser & formatter (`parse_duration`, `format_minutes`)
- `legacy/python/infra/db/quiz.py` (L1–L329): `QuizRepo` CRUD, answering, real-time author payout adjustments, debt fallback, withdrawal, settlement
- `legacy/python/services/quiz.py` (L1–L70): `QuizService` facade
- `legacy/python/cogs/quiz/cog.py` (L1–L280): `/クイズ 挑戦|出題|取り下げ`, 1-minute settlement loop, admin broadcast
- `legacy/python/cogs/quiz/embeds.py` (L1–L149): choice/term/verdict validation, question/result/public/settle embeds
- `legacy/python/cogs/quiz/views.py` (L1–L290): `PublicButton` (dynamic persistent), `AnswerView`, `AddModal`, `UserModal`
- `legacy/python/cogs/quiz/texts.py` (L1–L5): default verdict labels
- `legacy/python/cogs/shared/messages/games.py` (L72–L83): failure messages

---

## 2. Two Quiz Modes & Limits

| Property | Admin / Official Quiz (`author_id = 0`) | User-Authored Quiz (`author_id > 0`) |
|---|---|---|
| Scope | Global across guilds (`guild_id = 0`) | Guild-scoped (`guild_id = author's guild`) |
| Reward Source | System minted | Paid by author's wallet; shortfall creates Teiai debt via `owe_for` (`infra/db/quiz.py:165-168`) |
| Duration | Optional (`1 min` – `365 days`, or unlimited `None`) | Required (`1 min` – `10,080 min` / 7 days; default `4,320 min` / 3 days) |
| Reward Limit | `>= 1` (no upper cap; default `100`) | `>= 1` (no upper cap; requires author `balance >= reward` at post time, no debt) |
| Author Eligibility | Bot owner / admin | Must have `debt == 0`, `< 2` open quizzes (`OPEN_LIMIT = 2`), `< 3` posted in last 24h (`DAILY_LIMIT = 3`) |
| Answerer Eligibility | Any user (once per guild per quiz) | Same guild, `user_id != author_id`, once per quiz. **Reward & author-count gate**: `games_played >= 3` (`MIN_GAMES_FOR_REWARD = 3`) |
| Author Payout | None | System pays author dynamically on every eligible answer and finalizes on expiry/withdraw |

### Input Limits (`catalogs/economy.yaml:45-52`)
- Choices: exactly **4** unique non-empty lines (`choices[0]` is correct); stored shuffled in `shown_order` (`LETTERS = "ABCD"`).
- `MAX_QUESTION_LEN = 500`, `MAX_CHOICE_LEN = 80`, `MAX_EXPLANATION_LEN = 800`, `MAX_VERDICT_LEN = 20`.
- Bulk import (`domain/quizimport.py`): separated by `---`, comments `#`, max **`MAX_QUESTIONS = 30`**, rejects duplicate questions across file or DB, all-or-nothing.

---

## 3. Author Payout Formula (`domain/quizpay.py:14-57`)

Let `n` = eligible (`counted=1`, i.e. `games_played >= 3`) answerers, `c` = eligible correct answers, `r` = quiz reward per correct answer:

- If `n < 2` (`MIN_PARTICIPANTS = 2`): author receives `(0, 0, 0)`.
- Otherwise:
  - Accuracy proximity factor `f(n, c) = max(0.0, 1 - |c/n - 0.40| / 0.40)` (`TARGET_RATE = 0.40`; equals `1.0` at 40% correct, linearly drops to `0.0` at 0% or ≥80%).
  - Reward scale `m(r) = sqrt(max(r, 0) / 100)` (`REWARD_SCALE_BASE = 100`).
  - `base = round(100 * m(r))` (`BASE_REWARD = 100`)
  - `bonus = round(200 * f(n, c) * m(r))` (`MAX_BONUS = 200`)
  - `participation = round(f(n, c) * 1.0 * r * n)` (`PARTICIPATION_RATE = 1.0`)
  - `entitled = base + bonus + participation`.

### Real-Time Incremental Settlement (`infra/db/quiz.py:193-214`)
- On every eligible answer, `diff = entitled - quiz.earned` is settled immediately:
  - `diff > 0`: credit author (`クイズ出題報酬`, `income=diff`).
  - `diff < 0`: claw back from author up to available balance (`クイズ出題報酬（調整）`); `quiz.earned` tracks actual net `earned + moved`.
- At expiry (1-minute background tick) or `/クイズ 取り下げ`: runs final `_quiz_pay_author`, sets `settled = 1`, edits original post title to `📰 【終了】...` with `view=None`, and posts result embed listing right/wrong users mentioning the author.

---

## 4. Duration Parser (`domain/duration.py:6-33`)

- NFKC-normalized, strips commas. Units: `日`/`d` = `1440m`, `時間`/`時`/`h` = `60m`, `分`/`m` = `1m`.
- Bare integer uses `default_unit` (`"時間"` by default). Rejects duplicate units or leftover text.

---

## 5. Edge Cases

- If an answerer has `games_played < 3` on a user-authored quiz: answer IS recorded (`counted = 0`), correctness is shown, NO reward is paid (`reward_blocked = True`), author is NOT charged, and the answer does NOT count toward `n`/`c` for author payout (`infra/db/quiz.py:157-185`).
- If author's wallet cannot cover `reward` when an eligible player answers correctly: wallet is drained to 0, remainder goes through `debt.owe_for(gid, author, shortfall, "クイズの報酬の支払い")` (which runs forced liquidation/bankruptcy debt creation), and the answerer still receives full `reward`.
- `/クイズ 挑戦` picks the oldest unanswered unexpired quiz (`ORDER BY q.id`) matching `author_id=0 OR (guild_id=gid AND author_id!=uid)`.

---

## 6. Verbatim Japanese Strings

| Key ID | Verbatim Japanese String | Source |
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
