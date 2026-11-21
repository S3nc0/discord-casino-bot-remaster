/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures are untyped JSON */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planRig, shown, shownCounts, validateNewPoll, verdict } from './poll.ts';

const fx = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/legacy/polls/outcomes.json', import.meta.url),
    'utf8',
  ),
);

describe('polls (legacy parity)', () => {
  it.each(fx.shown_cases as any[])('shown($real, $adj) = $shown', ({ real, adj, shown: want }) => {
    expect(shown(real, adj)).toBe(want);
  });

  it('rigging stores offsets from the real votes (1 yes / 2 no -> 3 / 0)', () => {
    const rig = fx.db_flow.rig[1];
    const plan = planRig(
      { realYes: rig.before[0], realNo: rig.before[1] },
      rig.poll.yes,
      rig.poll.no,
    );
    expect(plan).toEqual({ ok: true, adjYes: rig.poll.adj_yes, adjNo: rig.poll.adj_no });
    expect(shownCounts({ realYes: 1, realNo: 2, adjYes: 2, adjNo: -2 })).toEqual({ yes: 3, no: 0 });
    // A later real "no" vote cannot push the shown count below 0 either way.
    expect(shownCounts({ realYes: 1, realNo: 3, adjYes: 2, adjNo: -2 })).toEqual({ yes: 3, no: 1 });
  });

  it('limits', () => {
    expect(planRig({ realYes: 0, realNo: 0 }, 1_000_001, 0)).toEqual({
      ok: false,
      error: 'poll_count_range',
    });
    expect(validateNewPoll('x', 1440, 5)).toBe('poll_open_limit');
    expect(validateNewPoll('', 10, 0)).toBe('poll_title_invalid');
    expect(validateNewPoll('x', 43_201, 0)).toBe('poll_duration_invalid');
    expect(validateNewPoll('x', 43_200, 4)).toBeNull();
    expect(verdict({ yes: 2, no: 1 })).toBe('yes');
    expect(verdict({ yes: 1, no: 2 })).toBe('no');
    expect(verdict({ yes: 2, no: 2 })).toBe('tie');
  });
});
