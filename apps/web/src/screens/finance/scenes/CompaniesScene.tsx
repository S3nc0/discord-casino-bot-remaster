import type { CSSProperties } from 'react';
import { COMPANIES_ART, COMPANY_PLATES } from '../art/companies.ts';
import { artBox, FinanceScene, useStill } from '../FinanceScene.tsx';
import { BadgePaths, SpinCoin } from '../sprites.tsx';

export interface SceneCompany {
  name: string;
  kind: 'farm' | 'mine';
}

/**
 * The business district: each company's badge on a tower, the tallest first. When `dividends`
 * is true (you hold stakes) coins drop from the first tower.
 */
export function CompaniesScene({
  companies,
  dividends,
  flash,
}: {
  companies: readonly SceneCompany[];
  dividends: boolean;
  flash?: { n: number; tone: 'buy' | 'sell' } | undefined;
}) {
  const still = useStill();
  const shown = companies.slice(0, COMPANY_PLATES.length);
  const first = COMPANY_PLATES[0];
  return (
    <FinanceScene
      art={COMPANIES_ART}
      name="companies"
      flash={flash}
      overlay={
        dividends && !still && first ? (
          <span className="fx-rain">
            {[0, 1, 2].map((k) => (
              <span
                key={k}
                className="fx-drop"
                style={
                  {
                    ...artBox(first[0] + 1 + (k - 1) * 8, first[1] + 12),
                    animationDelay: `${k * 600}ms`,
                  } as CSSProperties
                }
              >
                <SpinCoin size={3} />
              </span>
            ))}
          </span>
        ) : null
      }
    >
      {shown.map((c, i) => {
        const [x, y] = COMPANY_PLATES[i] ?? [0, 0];
        return (
          <g key={`${c.name}-${i}`} transform={`translate(${x} ${y})`} data-company={c.name}>
            <BadgePaths name={c.name} kind={c.kind} />
          </g>
        );
      })}
    </FinanceScene>
  );
}
