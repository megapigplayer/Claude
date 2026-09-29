import { Location } from '@hebcal/core';
import { describe, expect, it } from 'vitest';
import { computeZmanim } from '../src/lib/zmanim.js';

const CITIES = ['Jerusalem', 'Tel Aviv', 'New York', 'London', 'Sydney'] as const;
const DATES: [number, number, number][] = [
  [2026, 1, 2],
  [2026, 4, 3],
  [2026, 7, 3],
  [2026, 10, 9],
];

function iso(d: string | null): number {
  expect(d).not.toBeNull();
  return new Date(d as string).getTime();
}

describe('computeZmanim: monotonic order and internal invariants (5 cities x 4 dates)', () => {
  for (const cityName of CITIES) {
    for (const [year, month, day] of DATES) {
      it(`${cityName} ${year}-${month}-${day}: alot < netz < sofZmanShmaMga < sofZmanShmaGra < chatzot < minchaGedola < minchaKetana < plag < shkia < tzeit`, () => {
        const location = Location.lookup(cityName) as Location;
        const { block, hasSunset } = computeZmanim(location, new Date(year, month - 1, day), true);
        expect(hasSunset).toBe(true);
        // Pure sunrise/sunset-interval zmanim (netz, GRA Shma, chatzot, mincha gedola/ketana, plag,
        // shkia) are always defined once there IS a sunrise/sunset. Degree-based zmanim (alot, MGA
        // Shma, tzeit) estimate a fixed amount of light in the sky and can be undefined near
        // midsummer at higher latitudes (e.g. London) even though the sun does rise and set - a
        // real astronomical edge case, not a bug - so they are checked for order only when present.
        for (const v of [block.neitzHaChama, block.sofZmanShmaGra, block.chatzot, block.minchaGedola, block.minchaKetana, block.plagHaMincha, block.shkia]) {
          expect(v).not.toBeNull();
        }
        const order = [
          block.alotHaShachar,
          block.neitzHaChama,
          block.sofZmanShmaMga,
          block.sofZmanShmaGra,
          block.chatzot,
          block.minchaGedola,
          block.minchaKetana,
          block.plagHaMincha,
          block.shkia,
          block.tzeit,
        ]
          .filter((d): d is string => d !== null)
          .map(iso);
        for (let i = 1; i < order.length; i++) expect(order[i], `index ${i}`).toBeGreaterThan(order[i - 1] as number);
      });
    }
  }
});

describe('computeZmanim: tzeit is 20-55 minutes after shkia at Israeli latitudes (TOP60.md 4.4 invariant)', () => {
  it.each(['Jerusalem', 'Tel Aviv'] as const)('%s, all 4 test dates', (cityName) => {
    const location = Location.lookup(cityName) as Location;
    for (const [year, month, day] of DATES) {
      const { block } = computeZmanim(location, new Date(year, month - 1, day), true);
      const minutesAfter = (iso(block.tzeit) - iso(block.shkia)) / 60000;
      expect(minutesAfter, `${cityName} ${year}-${month}-${day}`).toBeGreaterThanOrEqual(20);
      expect(minutesAfter).toBeLessThanOrEqual(55);
    }
  });
});

describe('computeZmanim: no-sunset locations return null with hasSunset=false, never a crash', () => {
  it('Tromso, Norway (69.6N) around the summer solstice (midnight sun: no sunset)', () => {
    const tromso = new Location(69.6492, 18.9553, false, 'Europe/Oslo', 'Tromso', 'NO');
    const { block, hasSunset } = computeZmanim(tromso, new Date(2026, 5, 21), false);
    expect(hasSunset).toBe(false);
    for (const v of Object.values(block)) expect(v).toBeNull();
  });

  it('the same location in winter (a normal day - has sunrise/sunset)', () => {
    const tromso = new Location(69.6492, 18.9553, false, 'Europe/Oslo', 'Tromso', 'NO');
    const { hasSunset } = computeZmanim(tromso, new Date(2026, 9, 9), false);
    expect(hasSunset).toBe(true);
  });
});

describe('computeZmanim: useElevation affects sunrise/sunset-based zmanim only when elevation > 0', () => {
  it('Jerusalem (786m): shkia with elevation is later than or equal to without', () => {
    const location = Location.lookup('Jerusalem') as Location;
    const withElev = computeZmanim(location, new Date(2026, 9, 9), true).block.shkia;
    const withoutElev = computeZmanim(location, new Date(2026, 9, 9), false).block.shkia;
    expect(iso(withElev)).toBeGreaterThanOrEqual(iso(withoutElev));
  });
});
