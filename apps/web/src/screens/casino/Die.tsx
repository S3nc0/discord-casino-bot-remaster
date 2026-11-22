/** Pip positions on a 3 by 3 grid (cells 0..8, row by row) for each face. */
const PIPS: Readonly<Record<number, readonly number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export interface DieProps {
  /** 1..6; anything else shows a blank die. */
  face: number;
  /** Tumbling: the face is a stand-in and the die hops in steps. */
  rolling?: boolean;
  label?: string;
}

/** A 16 by 16 pixel die. Colours come from tokens through the `cc-die` classes. */
export function Die({ face, rolling = false, label }: DieProps) {
  const pips = PIPS[face] ?? [];
  return (
    <svg
      className={`cc-die${rolling ? ' cc-die--rolling' : ''}`}
      viewBox="0 0 16 16"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path className="cc-die__edge" d="M2 0h12v1h1v1h1v12h-1v1h-1v1H2v-1H1v-1H0V2h1V1h1z" />
      <path className="cc-die__face" d="M2 1h12v1h1v12h-1v1H2v-1H1V2h1z" />
      <path className="cc-die__shade" d="M2 14h12v1H2zM14 2h1v12h-1z" />
      {pips.map((cell) => (
        <rect
          key={cell}
          className="cc-die__pip"
          x={3 + (cell % 3) * 4}
          y={3 + Math.floor(cell / 3) * 4}
          width={2}
          height={2}
        />
      ))}
    </svg>
  );
}
