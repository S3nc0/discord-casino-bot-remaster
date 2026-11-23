import { useState } from 'react';
import {
  Banner,
  Button,
  Card,
  Dialog,
  PixelScene,
  SceneLayer,
  Tabs,
  Tag,
  TextField,
  useSceneFrame,
  useSceneOnce,
} from '@casino/ui';
import type { QuizAnswerResponse, QuizItem, QuizView } from '@casino/shared';
import { formatPelica, useLocale, useT } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { formatDuration } from './format.ts';
import { pushToast, useIntent, useLoad, useNow, usePlay } from './hooks.ts';
import { Await, LifeFrame } from './ui.tsx';
import { QUIZ_BULBS, QUIZ_BULBS_AT, QUIZ_RIGHT, QUIZ_STAGE, QUIZ_WRONG } from './quiz-art.ts';
import './social.css';

const LETTERS = 'ABCDEFGH';

/** The game-show stage above the quiz: the sign's bulbs chase (still under reduced motion). */
function Stage() {
  const bulbs = useSceneFrame(2, 600);
  return (
    <div className="sc-scene">
      <PixelScene art={QUIZ_STAGE} scale={2}>
        <SceneLayer art={QUIZ_BULBS} frame={bulbs} x={QUIZ_BULBS_AT.x} y={QUIZ_BULBS_AT.y} />
      </PixelScene>
    </div>
  );
}

/** A ring on the right answer, a cross on a wrong pick: plays once, then rests on its last frame. */
function AnswerFx({ right }: { right: boolean }) {
  const frame = useSceneOnce({ frames: [0, 1, 2], ms: 90, rest: 3, onMount: true });
  return (
    <PixelScene art={right ? QUIZ_RIGHT : QUIZ_WRONG} frame={frame} scale={2} className="sc-fx" />
  );
}

function Answer({ view, onNext }: { view: QuizView; onNext: () => Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const intent = useIntent();
  const play = usePlay();
  const now = useNow(1000);
  const [picked, setPicked] = useState<{
    quiz: QuizItem;
    result: QuizAnswerResponse;
    choice: number;
  } | null>(null);
  const quiz = picked?.quiz ?? view.next;

  if (!quiz) return <p className="life__empty">{t('screen.life.quiz.none')}</p>;

  const answer = (choice: number) =>
    void intent
      .run(`answer:${quiz.id}`, (key) => api.quizAnswer(quiz.id, choice, key))
      .then((result) => {
        if (!result) return;
        play(result.correct ? 'smallWin' : 'lose');
        setPicked({ quiz, result, choice });
      });

  const next = async () => {
    setPicked(null);
    await onNext();
  };

  return (
    <Card
      variant="elevated"
      className="sc-show"
      data-theme="dark"
      title={quiz.question}
      meta={
        quiz.authorName === null
          ? t('screen.life.quiz.official')
          : t('screen.life.quiz.by', { author: quiz.authorName })
      }
    >
      <p className="life__row">
        <Tag hue="yellow">
          {t('screen.life.quiz.reward', {
            reward: new Intl.NumberFormat(locale).format(quiz.reward),
          })}
        </Tag>
        {quiz.expiresAt !== null ? (
          <Tag hue="sky">
            {t('screen.life.quiz.closes', { time: formatDuration(t, quiz.expiresAt - now) })}
          </Tag>
        ) : null}
      </p>
      <ol className="life__choices" aria-label={quiz.question}>
        {quiz.choices.map((text, i) => {
          const result = picked?.result;
          const state = !result
            ? undefined
            : i === result.answer
              ? 'right'
              : i === picked?.choice
                ? 'wrong'
                : undefined;
          return (
            <li key={`${quiz.id}-${i}`}>
              <Button
                variant={state === 'right' ? 'filled' : 'tonal'}
                className="life__choice"
                data-state={state}
                disabled={intent.busy || !!result}
                onClick={() => answer(i)}
              >
                <span className="sc-letter" aria-hidden="true">
                  {LETTERS[i]}
                </span>
                {text}
              </Button>
              {state ? <AnswerFx right={state === 'right'} /> : null}
            </li>
          );
        })}
      </ol>
      {picked ? (
        <>
          <Banner
            variant={picked.result.correct ? 'success' : 'error'}
            title={
              picked.result.correct
                ? t('screen.life.quiz.right')
                : t('screen.life.quiz.wrong', { answer: quiz.choices[picked.result.answer] ?? '' })
            }
          >
            {picked.result.reward > 0
              ? t('screen.life.quiz.paid', {
                  reward: new Intl.NumberFormat(locale).format(picked.result.reward),
                })
              : null}
            {picked.result.rewardBlocked
              ? t('screen.life.quiz.blocked', {
                  min: view.limits.minGames,
                  played: view.gamesPlayed,
                })
              : null}
          </Banner>
          {picked.result.explanation ? (
            <p className="life__note">
              <strong>{t('screen.life.quiz.explanation')}: </strong>
              {picked.result.explanation}
            </p>
          ) : null}
          <Button onClick={() => void next()}>{t('screen.life.quiz.next')}</Button>
        </>
      ) : null}
    </Card>
  );
}

function Post({ view, onPosted }: { view: QuizView; onPosted: () => Promise<void> }) {
  const t = useT();
  const api = useLifeApi();
  const intent = useIntent();
  const { limits } = view;
  const [question, setQuestion] = useState('');
  const [right, setRight] = useState('');
  const [wrong, setWrong] = useState(['', '', '']);
  const [explanation, setExplanation] = useState('');
  const [reward, setReward] = useState('100');
  const [minutes, setMinutes] = useState(String(limits.defaultMinutes));
  const choices = [right, ...wrong].map((c) => c.trim());
  const rewardNum = Number(reward);
  const minutesNum = Number(minutes);
  const valid =
    question.trim().length > 0 &&
    choices.every((c) => c.length > 0) &&
    Number.isInteger(rewardNum) &&
    rewardNum >= 1 &&
    Number.isInteger(minutesNum) &&
    minutesNum >= limits.minMinutes &&
    minutesNum <= limits.maxMinutes;
  const submit = () =>
    void intent
      .run('post', (key) =>
        api.quizPost(
          {
            question: question.trim(),
            choices,
            reward: rewardNum,
            minutes: minutesNum,
            ...(explanation.trim() ? { explanation: explanation.trim() } : {}),
          },
          key,
        ),
      )
      .then(async (r) => {
        if (!r) return;
        setQuestion('');
        setRight('');
        setWrong(['', '', '']);
        setExplanation('');
        pushToast('success', 'screen.life.quiz.posted');
        await onPosted();
      });
  return (
    <form
      className="life__form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <TextField
        label={t('screen.life.quiz.f.question')}
        value={question}
        maxLength={limits.questionMax}
        onChange={(e) => setQuestion(e.target.value)}
      />
      <TextField
        label={t('screen.life.quiz.f.right')}
        value={right}
        maxLength={limits.choiceMax}
        onChange={(e) => setRight(e.target.value)}
      />
      {wrong.map((w, i) => (
        <TextField
          key={i}
          label={t('screen.life.quiz.f.wrong', { n: i + 1 })}
          value={w}
          maxLength={limits.choiceMax}
          onChange={(e) => setWrong(wrong.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <TextField
        label={t('screen.life.quiz.f.explanation')}
        value={explanation}
        maxLength={limits.explanationMax}
        onChange={(e) => setExplanation(e.target.value)}
      />
      <TextField
        label={t('screen.life.quiz.f.reward')}
        value={reward}
        inputMode="numeric"
        onChange={(e) => setReward(e.target.value)}
      />
      <TextField
        label={t('screen.life.quiz.f.minutes')}
        value={minutes}
        inputMode="numeric"
        onChange={(e) => setMinutes(e.target.value)}
      />
      <Button type="submit" disabled={!valid || intent.busy}>
        {t('screen.life.quiz.submit')}
      </Button>
      <p className="life__note">{t('screen.life.quiz.hint')}</p>
      <p className="life__note">
        {t('screen.life.quiz.limits', {
          openLimit: limits.openLimit,
          dailyLimit: limits.dailyLimit,
        })}
      </p>
    </form>
  );
}

function Mine({ view, onChanged }: { view: QuizView; onChanged: () => Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const intent = useIntent();
  const now = useNow(1000);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  const nf = new Intl.NumberFormat(locale);
  if (view.mine.length === 0)
    return <p className="life__empty">{t('screen.life.quiz.mineNone')}</p>;
  const withdraw = (id: number) => {
    setWithdrawing(null);
    void intent
      .run(`withdraw:${id}`, (key) => api.quizWithdraw(id, key))
      .then(async (r) => {
        if (!r) return;
        pushToast('success', 'screen.life.quiz.withdrawn');
        await onChanged();
      });
  };
  return (
    <>
      <ul className="life__list">
        {view.mine.map((q) => (
          <li key={q.id}>
            <Card variant="filled" title={q.question}>
              <p className="life__note">
                {t('screen.life.quiz.mineStats', {
                  answers: q.answers,
                  correct: q.correct,
                  earned: formatPelica(locale, q.earned),
                })}
              </p>
              <div className="life__row">
                <Tag hue="yellow">
                  {t('screen.life.quiz.reward', { reward: nf.format(q.reward) })}
                </Tag>
                {q.expiresAt !== null ? (
                  <Tag hue="sky">
                    {t('screen.life.quiz.closes', { time: formatDuration(t, q.expiresAt - now) })}
                  </Tag>
                ) : null}
                <Button
                  variant="outlined"
                  disabled={intent.busy}
                  onClick={() => setWithdrawing(q.id)}
                >
                  {t('screen.life.quiz.withdraw')}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Dialog
        open={withdrawing !== null}
        onClose={() => setWithdrawing(null)}
        role="alertdialog"
        title={t('screen.life.quiz.withdrawTitle')}
        description={t('screen.life.quiz.withdrawBody')}
        actions={
          <>
            <Button variant="text" onClick={() => setWithdrawing(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => withdrawing !== null && withdraw(withdrawing)}>
              {t('screen.life.quiz.withdraw')}
            </Button>
          </>
        }
      />
    </>
  );
}

export default function QuizScreen() {
  const t = useT();
  const api = useLifeApi();
  const state = useLoad(() => api.quiz(), 30_000);
  return (
    <LifeFrame screen="quiz" icon="quiz">
      <Stage />
      <Await state={state}>
        {(v) => (
          <Tabs
            label={t('screen.quiz')}
            defaultActiveId="answer"
            tabs={[
              {
                id: 'answer',
                label: t('screen.life.quiz.tab.answer'),
                panel: <Answer view={v} onNext={state.reload} />,
              },
              {
                id: 'post',
                label: t('screen.life.quiz.tab.post'),
                panel: <Post view={v} onPosted={state.reload} />,
              },
              {
                id: 'mine',
                label: t('screen.life.quiz.tab.mine'),
                panel: <Mine view={v} onChanged={state.reload} />,
              },
            ]}
          />
        )}
      </Await>
    </LifeFrame>
  );
}
