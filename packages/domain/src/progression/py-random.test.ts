import { describe, expect, it } from 'vitest';
import { PyRandom, sha512, utf8 } from './py-random.ts';

describe('PyRandom (values taken from CPython 3)', () => {
  it('random(), gauss(), randint() with an int seed', () => {
    const r = new PyRandom(2002);
    expect([r.float(), r.float(), r.float()]).toEqual([
      0.7274911403686816, 0.5002834373979512, 0.7775030705398818,
    ]);
    expect(r.gauss(0, 1)).toBeCloseTo(-1.8965935207906492, 12);
    expect(r.int(1, 101)).toBe(38);
  });

  it('string seeds hash like CPython (sha512 appended)', () => {
    expect(new PyRandom('mission:2025-01-06').float()).toBe(0.1570113444932374);
    expect(new PyRandom(0).float()).toBe(0.8444218515250481);
  });

  it('sha512 matches the standard vector for "abc"', () => {
    const hex = [...sha512(utf8('abc'))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex.startsWith('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a')).toBe(
      true,
    );
  });
});
