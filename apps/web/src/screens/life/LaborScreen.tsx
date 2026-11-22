import { useMemo, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Chip,
  ChipGroup,
  GameIcon,
  List,
  ListItem,
  Progress,
  Switch,
  Tabs,
  Tag,
} from '@casino/ui';
import type { ToolWire, WorkClickResponse, WorkerKindWire, WorkView } from '@casino/shared';
import { formatPelica, useLocale, useT, type Translate } from '../../shell/i18n.ts';
import { useLifeApi } from './api.tsx';
import { formatDuration } from './format.ts';
import { pushToast, useIntent, useLoad, useNow, usePlay } from './hooks.ts';
import { Await, LifeFrame, Stat } from './ui.tsx';

const MEDALS = ['🥇', '🥈', '🥉'];
const RECOVER_PER_SEC = 0.1;

/** `relic_vase_s2` → `Ancient vase★★`. */
export function relicName(t: Translate, id: string): string {
  const m = /^(relic_[a-z]+)(?:_s(\d))?$/.exec(id);
  if (!m) return id;
  return `${t(`screen.life.relic.${m[1]}`)}${'★'.repeat(Number(m[2] ?? 0))}`;
}

const oreName = (t: Translate, id: string) => t(`screen.life.work.ore.${id}`);

/** The pay of the next dig at a fatigue level (display only; the server decides). */
const payAt = (pick: number, fatigue: number) =>
  Math.max(1, Math.round((10 + 4 * pick) * (1 - 0.8 * (fatigue / 100))));

function Dig({
  view,
  reload,
  patch,
}: {
  view: WorkView;
  reload: () => Promise<void>;
  patch: (f: (v: WorkView) => WorkView) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const intent = useIntent();
  const play = usePlay();
  const now = useNow(1000);
  const nf = new Intl.NumberFormat(locale);
  const seenAt = useMemo(() => Date.now(), [view]);
  const [last, setLast] = useState<WorkClickResponse | null>(null);
  const fatigue = Math.max(
    0,
    view.fatigue - ((now - seenAt) / 1000) * RECOVER_PER_SEC * (1 + (view.buffs.recovery ?? 0)),
  );
  const hasDug = Object.keys(view.ores).length + Object.keys(view.relics).length > 0;

  const dig = () =>
    void intent
      .run('click', (key) => api.workClick(key))
      .then((r) => {
        if (!r) return;
        setLast(r);
        if (r.tooFast) return;
        play(r.crit ? 'bigWin' : 'chip');
        patch((v) => ({
          ...v,
          fatigue: r.fatigue,
          clicks: v.clicks + 1,
          dayClicks: v.dayClicks + 1,
          clickPay: payAt(v.pick, r.fatigue),
        }));
      });

  const collect = () =>
    void intent
      .run('collect', (key) => api.workCollect(key))
      .then(async (r) => {
        if (!r) return;
        play('cashRegister');
        pushToast('success', 'screen.life.work.collected', {
          net: nf.format(r.net),
          skimmed: nf.format(r.skimmed),
        });
        setLast(null);
        await reload();
      });

  const drink = () =>
    void intent
      .run('drink', (key) => api.workDrink(key))
      .then(async (r) => {
        if (!r) return;
        play('click');
        pushToast('success', 'screen.life.work.drank', { fatigue: Math.round(r.fatigue) });
        await reload();
      });

  const upgrade = (tool: ToolWire | 'dorm') =>
    void intent
      .run(`up:${tool}`, (key) => api.workUpgrade(tool, key))
      .then(async (r) => {
        if (!r) return;
        play('coin');
        pushToast('success', 'screen.life.work.upgraded', {
          tool: t(`screen.life.work.tool.${tool}`),
          level: r.level,
        });
        await reload();
      });

  const feedback = last
    ? last.tooFast
      ? t('screen.life.work.tooFast')
      : [
          last.crit
            ? t('screen.life.work.crit', { pay: nf.format(last.pay) })
            : `+${nf.format(last.pay)}`,
          last.combo ? t('screen.life.work.combo') : '',
          last.ore ? t('screen.life.work.found', { ore: oreName(t, last.ore) }) : '',
          last.capped ? t('screen.life.work.capped', { pay: last.pay }) : '',
        ]
          .filter(Boolean)
          .join(' · ')
    : t('screen.life.work.hint');

  return (
    <>
      <Card variant="elevated" className="life-dig">
        <div className="life-stats">
          <Stat
            label={t('screen.life.work.pot')}
            value={formatPelica(locale, view.pot)}
            tone="coin"
          />
        </div>
        <p className="life__note">
          {t('screen.life.work.pay', { pay: nf.format(payAt(view.pick, fatigue)) })}
        </p>
        <Progress
          label={t('screen.life.work.fatigue')}
          value={fatigue}
          max={100}
          valueLabel={`${Math.round(fatigue)} / 100`}
        />
        <Button
          className="life-dig__button"
          icon={<GameIcon name="pickaxe" />}
          disabled={intent.busy}
          onClick={dig}
        >
          {t('screen.life.work.dig')}
        </Button>
        <p className="life__feedback" role="status" aria-live="polite">
          {feedback}
        </p>
        <div className="life__actions">
          <Button
            variant="tonal"
            disabled={intent.busy || (view.pot <= 0 && !hasDug)}
            onClick={collect}
          >
            {t('screen.life.work.collect')}
          </Button>
          <Button
            variant="outlined"
            disabled={intent.busy || fatigue < 1 || view.drinks < 1}
            onClick={drink}
          >
            {t('screen.life.work.drink', { n: view.drinks })}
          </Button>
        </div>
        <p className="life__note">{t('screen.life.work.skim', { pct: view.skimBps / 100 })}</p>
        {hasDug ? (
          <div>
            <p className="life__note life__note--strong">{t('screen.life.work.dug')}</p>
            <ul className="life__tags">
              {Object.entries(view.ores).map(([id, n]) => (
                <li key={id}>
                  <Tag hue="amber">
                    {oreName(t, id)} ×{n}
                  </Tag>
                </li>
              ))}
              {Object.entries(view.relics).map(([id, n]) => (
                <li key={id}>
                  <Tag hue="violet">
                    {relicName(t, id)} ×{n}
                  </Tag>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Progress
          label={t('screen.life.work.dayCap', { done: view.dayClicks, cap: view.dayCap })}
          value={Math.min(view.dayClicks, view.dayCap)}
          max={view.dayCap}
          valueLabel=""
          variant={view.dayClicks >= view.dayCap ? 'success' : 'primary'}
        />
        <p className="life__note">
          {t('screen.life.work.terrain', {
            terrain: t(`screen.life.work.terrain.${view.terrain}`),
          })}
        </p>
      </Card>
      <ul className="life__list">
        {(['pick', 'glove'] as const).map((tool) => {
          const cost = view.upgrade[tool];
          const level = view[tool];
          return (
            <li key={tool}>
              <Card variant="filled" className="life-tool">
                <div className="life__row">
                  <div>
                    <p className="life-tool__name">{t(`screen.life.work.tool.${tool}`)}</p>
                    <p className="life__note">{t(`screen.life.work.tool.${tool}Note`)}</p>
                  </div>
                  <Tag hue="sky">{t('screen.life.work.level', { level, max: view.maxLevel })}</Tag>
                </div>
                {cost === null ? (
                  <Tag hue="green">{t('screen.life.work.maxed')}</Tag>
                ) : (
                  <Button
                    variant="tonal"
                    disabled={intent.busy || view.balance < cost}
                    onClick={() => upgrade(tool)}
                  >
                    {t('screen.life.work.upgrade', { cost: nf.format(cost) })}
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Crew({ view, reload }: { view: WorkView; reload: () => Promise<void> }) {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const intent = useIntent();
  const play = usePlay();
  const now = useNow(1000);
  const nf = new Intl.NumberFormat(locale);
  const full = view.workers.length >= view.slots;
  const renewOn = view.workers.length > 0 && view.workers.every((w) => w.renew);
  const kindName = (k: WorkerKindWire) => t(`screen.life.work.worker.${k}`);

  const hire = (kind: WorkerKindWire) =>
    void intent
      .run(`hire:${kind}`, (key) => api.workHire(kind, key))
      .then(async (r) => {
        if (!r) return;
        play('coin');
        pushToast('success', 'screen.life.work.hired', { name: kindName(kind) });
        await reload();
      });
  const dismiss = (kind: WorkerKindWire) =>
    void intent
      .run(`dismiss:${kind}`, (key) => api.workDismiss(kind, key))
      .then(async (r) => {
        if (!r) return;
        pushToast('info', 'screen.life.work.dismissed', { name: kindName(kind) });
        await reload();
      });
  const renew = (on: boolean) =>
    void intent
      .run('renew', (key) => api.workRenew(on, key))
      .then(async (r) => {
        if (r) await reload();
      });
  const dorm = () =>
    void intent
      .run('up:dorm', (key) => api.workUpgrade('dorm', key))
      .then(async (r) => {
        if (!r) return;
        play('coin');
        pushToast('success', 'screen.life.work.upgraded', {
          tool: t('screen.life.work.tool.dorm'),
          level: r.level,
        });
        await reload();
      });

  return (
    <>
      <div className="life__row">
        <Tag hue={full ? 'orange' : 'green'}>
          {t('screen.life.work.slots', { n: view.workers.length, slots: view.slots })}
        </Tag>
        <Switch
          label={t('screen.life.work.renew')}
          checked={renewOn}
          disabled={intent.busy || view.workers.length === 0}
          onLabel={t('screen.life.on')}
          offLabel={t('screen.life.off')}
          onChange={renew}
        />
      </div>
      <p className="life__note">{t('screen.life.work.renewHelp')}</p>
      {view.workers.length === 0 ? (
        <p className="life__empty">{t('screen.life.work.noCrew')}</p>
      ) : (
        <List label={t('screen.life.work.tab.crew')}>
          {view.workers.map((w) => (
            <ListItem
              key={w.id}
              headline={kindName(w.kind)}
              supportingText={t('screen.life.work.contract', {
                time: formatDuration(t, w.expiresAt - now),
              })}
              leading={<Avatar>{kindName(w.kind).slice(0, 1)}</Avatar>}
              trailing={
                <Button variant="text" disabled={intent.busy} onClick={() => dismiss(w.kind)}>
                  {t('screen.life.work.dismiss')}
                </Button>
              }
            />
          ))}
        </List>
      )}
      <h2 className="bb-eyebrow">{t('screen.life.work.tab.crew')}</h2>
      <ul className="life__list">
        {view.hire.map((h) => (
          <li key={h.kind}>
            <Card variant="filled" className="life-tool">
              <div className="life__row">
                <div>
                  <p className="life-tool__name">{kindName(h.kind)}</p>
                  <p className="life__note">
                    {h.kind === 'foreman'
                      ? t('screen.life.work.worker.foremanNote')
                      : t('screen.life.work.hourly', { n: nf.format(h.hourly) })}
                  </p>
                </div>
                <Button
                  variant="tonal"
                  disabled={intent.busy || full || view.balance < h.fee}
                  onClick={() => hire(h.kind)}
                >
                  {t('screen.life.work.hire', { fee: nf.format(h.fee) })}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="life__note">{t('screen.life.work.hireNote')}</p>
      <Card variant="filled" className="life-tool">
        <div className="life__row">
          <div>
            <p className="life-tool__name">{t('screen.life.work.tool.dorm')}</p>
            <p className="life__note">{t('screen.life.work.tool.dormNote')}</p>
          </div>
          <Tag hue="sky">
            {t('screen.life.work.level', { level: view.dorm, max: view.dormMax })}
          </Tag>
        </div>
        {view.upgrade.dorm === null ? (
          <Tag hue="green">{t('screen.life.work.maxed')}</Tag>
        ) : (
          <Button
            variant="tonal"
            disabled={intent.busy || view.balance < view.upgrade.dorm}
            onClick={dorm}
          >
            {t('screen.life.work.upgrade', { cost: nf.format(view.upgrade.dorm) })}
          </Button>
        )}
      </Card>
    </>
  );
}

function Relics({ view, reload }: { view: WorkView; reload: () => Promise<void> }) {
  const t = useT();
  const api = useLifeApi();
  const intent = useIntent();
  const play = usePlay();
  const entries = Object.entries(view.held).sort(([a], [b]) => a.localeCompare(b));
  const merge = (id: string) =>
    void intent
      .run(`merge:${id}`, (key) => api.workMerge(id, key))
      .then(async (r) => {
        if (!r) return;
        play('bigWin');
        pushToast('success', 'screen.life.relic.merged', { name: relicName(t, r.itemId) });
        await reload();
      });
  const buffs = Object.entries(view.buffs).filter(([, v]) => v > 0);
  return (
    <>
      <p className="life__note">{t('screen.life.relic.rule')}</p>
      {entries.length === 0 ? (
        <p className="life__empty">{t('screen.life.relic.none')}</p>
      ) : (
        <List label={t('screen.life.work.tab.relics')}>
          {entries.map(([id, qty]) => {
            const star = Number(/_s(\d)$/.exec(id)?.[1] ?? 0);
            const base = id.replace(/_s\d$/, '');
            const buffKey = RELIC_BUFF[base];
            const pct = Math.round((view.buffs[buffKey ?? ''] ?? 0) * 100);
            const nextId = `${base}_s${star + 1}`;
            return (
              <ListItem
                key={id}
                headline={`${relicName(t, id)}  ×${qty}`}
                supportingText={
                  buffKey
                    ? t('screen.life.relic.buffLine', {
                        pct: view.mergeCount ** star,
                        what: t(`screen.life.relic.buff.${buffKey}`),
                      })
                    : undefined
                }
                leading={<Avatar>{star > 0 ? '★'.repeat(star) : '◆'}</Avatar>}
                trailing={
                  qty >= view.mergeCount && star < view.starMax ? (
                    <Button variant="tonal" disabled={intent.busy} onClick={() => merge(id)}>
                      {t('screen.life.relic.merge', { name: relicName(t, nextId) })}
                    </Button>
                  ) : pct > 0 ? (
                    <Tag hue="neutral">+{pct}%</Tag>
                  ) : undefined
                }
              />
            );
          })}
        </List>
      )}
      {buffs.length > 0 ? (
        <>
          <h2 className="bb-eyebrow">{t('screen.life.relic.total')}</h2>
          <ul className="life__tags">
            {buffs.map(([k, v]) => (
              <li key={k}>
                <Tag hue="violet">
                  {t(`screen.life.relic.buff.${k}`)} +{Math.round(v * 100)}%
                </Tag>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

const RELIC_BUFF: Record<string, string> = {
  relic_fossil: 'click',
  relic_bone: 'wage',
  relic_meteor: 'luck',
  relic_vase: 'recovery',
  relic_crown: 'daily',
  relic_tear: 'prize',
};

function Ranking() {
  const t = useT();
  const locale = useLocale();
  const api = useLifeApi();
  const [period, setPeriod] = useState<'total' | 'today'>('today');
  const state = useLoad(() => api.workRanking(period), 0, period);
  const nf = new Intl.NumberFormat(locale);
  return (
    <>
      <ChipGroup label={t('screen.life.work.tab.ranking')}>
        <Chip selected={period === 'today'} onClick={() => setPeriod('today')}>
          {t('screen.life.work.rankToday')}
        </Chip>
        <Chip selected={period === 'total'} onClick={() => setPeriod('total')}>
          {t('screen.life.work.rankTotal')}
        </Chip>
      </ChipGroup>
      <Await state={state}>
        {(r) => (
          <>
            {r.rows.length === 0 ? (
              <p className="life__empty">{t('screen.life.work.rankNone')}</p>
            ) : (
              <List label={t('screen.life.work.tab.ranking')}>
                {r.rows.map((row) => (
                  <ListItem
                    key={row.userId}
                    headline={row.name}
                    supportingText={t('screen.life.work.rankRow', {
                      clicks: nf.format(row.clicks),
                    })}
                    leading={<Avatar>{MEDALS[row.rank - 1] ?? String(row.rank)}</Avatar>}
                    trailing={
                      <span className="life__plus">{formatPelica(locale, row.earned)}</span>
                    }
                  />
                ))}
              </List>
            )}
            {r.self ? (
              <p className="life__note life__note--strong">
                {t('screen.life.work.rankSelf', { rank: r.self.rank, total: r.total })}
              </p>
            ) : null}
          </>
        )}
      </Await>
    </>
  );
}

export default function LaborScreen() {
  const t = useT();
  const api = useLifeApi();
  const state = useLoad(() => api.work(), 30_000);
  return (
    <LifeFrame screen="work" icon="pickaxe">
      <Await state={state}>
        {(v) => (
          <Tabs
            label={t('screen.life.work.title')}
            defaultActiveId="dig"
            tabs={[
              {
                id: 'dig',
                label: t('screen.life.work.tab.dig'),
                panel: <Dig view={v} reload={state.reload} patch={state.patch} />,
              },
              {
                id: 'crew',
                label: t('screen.life.work.tab.crew'),
                panel: <Crew view={v} reload={state.reload} />,
              },
              {
                id: 'relics',
                label: t('screen.life.work.tab.relics'),
                panel: <Relics view={v} reload={state.reload} />,
              },
              { id: 'ranking', label: t('screen.life.work.tab.ranking'), panel: <Ranking /> },
            ]}
          />
        )}
      </Await>
    </LifeFrame>
  );
}
