import { useState } from 'react';
import { Button, Card, Chip, ChipGroup, Progress, Tag, TextField } from '@casino/ui';
import type { PollItem, PollsView } from '@casino/shared';
import { useLocale, useT } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { formatDuration } from './format.ts';
import { pushToast, useIntent, useLoad, useNow } from './hooks.ts';
import { Await, LifeFrame } from './ui.tsx';

const DURATIONS = [60, 1440, 4320] as const;

function PollCard({
  poll,
  now,
  busy,
  onVote,
}: {
  poll: PollItem;
  now: number;
  busy: boolean;
  onVote: (poll: PollItem, yes: boolean) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const open = poll.status === 'open' && poll.closesAt > now;
  const total = Math.max(1, poll.yes + poll.no);
  return (
    <Card
      variant="filled"
      className="life-poll"
      title={poll.title}
      meta={t('screen.life.poll.by', { name: poll.creatorName })}
    >
      <Progress
        label={t('screen.life.poll.yes')}
        value={poll.yes}
        max={total}
        valueLabel={nf.format(poll.yes)}
        variant="success"
      />
      <Progress
        label={t('screen.life.poll.no')}
        value={poll.no}
        max={total}
        valueLabel={nf.format(poll.no)}
      />
      <div className="life__row">
        <span className="life__note">
          {t('screen.life.poll.votes', { n: nf.format(poll.yes + poll.no) })} ·{' '}
          {open
            ? t('screen.life.poll.closes', { time: formatDuration(t, poll.closesAt - now) })
            : t('screen.life.poll.closed')}
        </span>
        {open ? (
          <Tag hue="green">{t('screen.life.poll.open')}</Tag>
        ) : (
          <Tag hue="neutral">{t('screen.life.poll.closed')}</Tag>
        )}
      </div>
      {open ? (
        <div className="life__actions" role="group" aria-label={poll.title}>
          <Button
            variant={poll.myVote === 'yes' ? 'filled' : 'tonal'}
            disabled={busy}
            aria-pressed={poll.myVote === 'yes'}
            onClick={() => onVote(poll, true)}
          >
            {t('screen.life.poll.yes')}
          </Button>
          <Button
            variant={poll.myVote === 'no' ? 'filled' : 'tonal'}
            disabled={busy}
            aria-pressed={poll.myVote === 'no'}
            onClick={() => onVote(poll, false)}
          >
            {t('screen.life.poll.no')}
          </Button>
        </div>
      ) : (
        <p className="life__note life__note--strong">
          {t(`screen.life.poll.result.${poll.verdict}`)}
        </p>
      )}
      {poll.myVote ? (
        <p className="life__note">
          {t('screen.life.poll.mine', { vote: t(`screen.life.poll.${poll.myVote}`) })}
        </p>
      ) : null}
    </Card>
  );
}

function CreateForm({ view, onCreated }: { view: PollsView; onCreated: () => Promise<void> }) {
  const t = useT();
  const api = useLifeApi();
  const intent = useIntent();
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState<number>(view.limits.defaultMinutes);
  const label = (m: number) => formatDuration(t, m * 60_000);
  const submit = () =>
    void intent
      .run('create', (key) => api.pollCreate({ title: title.trim(), minutes }, key))
      .then(async (r) => {
        if (!r) return;
        setTitle('');
        pushToast('success', 'screen.life.poll.created');
        await onCreated();
      });
  return (
    <Card variant="outlined" title={t('screen.life.poll.create')}>
      <form
        className="life__form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t('screen.life.poll.f.title')}
          value={title}
          maxLength={view.limits.titleMax}
          onChange={(e) => setTitle(e.target.value)}
        />
        <ChipGroup label={t('screen.life.poll.f.minutes')}>
          {DURATIONS.map((m) => (
            <Chip key={m} selected={minutes === m} onClick={() => setMinutes(m)}>
              {label(m)}
            </Chip>
          ))}
        </ChipGroup>
        <Button type="submit" disabled={intent.busy || title.trim().length === 0}>
          {t('screen.life.poll.submit')}
        </Button>
        <p className="life__note">{t('screen.life.poll.limits', { max: view.limits.maxOpen })}</p>
      </form>
    </Card>
  );
}

export default function PollScreen() {
  const t = useT();
  const api = useLifeApi();
  const state = useLoad(() => api.polls(), 20_000);
  const intent = useIntent();
  const now = useNow(1000);
  const vote = (poll: PollItem, yes: boolean) =>
    void intent
      .run(`vote:${poll.id}:${yes}`, (key) => api.pollVote(poll.id, yes, key))
      .then(async (r) => {
        if (!r) return;
        pushToast('success', 'screen.life.poll.voted');
        await state.reload();
      });
  return (
    <LifeFrame screen="poll" icon="poll">
      <Await state={state}>
        {(v) => (
          <>
            <CreateForm view={v} onCreated={state.reload} />
            {v.polls.length === 0 ? (
              <p className="life__empty">{t('screen.life.poll.none')}</p>
            ) : (
              <ul className="life__list">
                {v.polls.map((p) => (
                  <li key={p.id}>
                    <PollCard poll={p} now={now} busy={intent.busy} onVote={vote} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Await>
    </LifeFrame>
  );
}
