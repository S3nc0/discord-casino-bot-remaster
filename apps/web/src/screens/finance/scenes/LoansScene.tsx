import { LOANS_ART } from '../art/loans.ts';
import { FinanceScene, usePlayback } from '../FinanceScene.tsx';

const STAMP = [0, 1, 2, 2, 3, -1];

/** The loan office. Each time `signed` goes up the stamp seals the contract on the desk. */
export function LoansScene({ signed }: { signed: number }) {
  const frame = usePlayback(STAMP, 140, signed);
  return <FinanceScene art={LOANS_ART} name="loans" frame={frame} />;
}
