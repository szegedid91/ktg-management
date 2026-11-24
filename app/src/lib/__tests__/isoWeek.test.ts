import { describe, it, expect } from 'vitest';
import { isoWeek, weekRangeLabel } from '../format';

describe('isoWeek', () => {
  it('hét közben és a hét szélein ugyanaz a hét', () => {
    expect(isoWeek('2026-11-16')).toEqual({ year: 2026, week: 47 }); // hétfő
    expect(isoWeek('2026-11-19')).toEqual({ year: 2026, week: 47 });
    expect(isoWeek('2026-11-22')).toEqual({ year: 2026, week: 47 }); // vasárnap
    expect(isoWeek('2026-11-23')).toEqual({ year: 2026, week: 48 });
  });
  it('évforduló: a hét ahhoz az évhez tartozik, amelyikben a csütörtökje van', () => {
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 }); // csütörtök
    expect(isoWeek('2026-12-31')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 }); // péntek, még a 2026/53. hét
    expect(isoWeek('2027-01-04')).toEqual({ year: 2027, week: 1 });
    expect(isoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 }); // hétfő, már a 2025/1. hét
  });
});

describe('weekRangeLabel', () => {
  it('egy hét, több hét, évforduló, nyitott kezdet', () => {
    expect(weekRangeLabel('2026-11-16', '2026-11-22')).toBe('47. hét');
    expect(weekRangeLabel('2026-11-01', '2026-11-30')).toBe('44–49. hét');
    expect(weekRangeLabel('2026-12-28', '2027-01-10')).toBe('2026/53 – 2027/1. hét');
    expect(weekRangeLabel('', '2026-11-22')).toBe('47. hétig');
  });
});
