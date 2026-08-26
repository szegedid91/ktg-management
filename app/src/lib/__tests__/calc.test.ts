import { describe, it, expect } from 'vitest';
import { fromNet, fromGross, attendanceAmount, commissionAmount } from '../calc';
import { ft, hd, parseAmount } from '../format';

describe('ÁFA-számítás', () => {
  it('nettóból bruttó (27%)', () => {
    const a = fromNet(100000, 27);
    expect(a.vat).toBe(27000);
    expect(a.gross).toBe(127000);
  });
  it('bruttóból nettó (27%)', () => {
    const a = fromGross(127000, 27);
    expect(a.net).toBe(100000);
    expect(a.vat).toBe(27000);
  });
  it('0% ÁFA', () => {
    const a = fromNet(50000, 0);
    expect(a.gross).toBe(50000);
    expect(a.vat).toBe(0);
  });
});

describe('Bérköltség (a DB triggerrel azonos logika)', () => {
  it('órabér', () => expect(attendanceAmount('hourly', 5000, 8, 1)).toBe(40000));
  it('napi díj', () => expect(attendanceAmount('daily', 40000, null, 1)).toBe(40000));
  it('fél nap', () => expect(attendanceAmount('daily', 40000, null, 0.5)).toBe(20000));
  it('projektdíj', () => expect(attendanceAmount('project', 200000, null, 1)).toBe(200000));
  it('jelenlét díj nélkül', () => expect(attendanceAmount('presence', 40000, null, 1)).toBe(0));
});

describe('Közvetítői díj (osztódik, nem adódik)', () => {
  it('fix napi díjból', () =>
    expect(commissionAmount(40000, 'fixed', 10000, 'day', 'daily', null, 1)).toBe(10000));
  it('fix fél napra arányosan', () =>
    expect(commissionAmount(20000, 'fixed', 10000, 'day', 'daily', null, 0.5)).toBe(5000));
  it('százalékos', () =>
    expect(commissionAmount(40000, 'percent', 10, null, 'hourly', 8, 1)).toBe(4000));
  it('nem lépheti túl a bérköltséget', () =>
    expect(commissionAmount(5000, 'fixed', 10000, 'day', 'daily', null, 1)).toBe(5000));
  it('jelenlétnél nincs', () =>
    expect(commissionAmount(0, 'percent', 10, null, 'presence', null, 1)).toBe(0));
});

describe('Magyar formázás', () => {
  it('ezres tagolás szóközzel', () => expect(ft(1250000)).toBe('1 250 000 Ft'));
  it('negatív összeg', () => expect(ft(-94000)).toBe('-94 000 Ft'));
  it('dátum', () => expect(hd('2026-08-26')).toBe('2026.08.26.'));
  it('összeg-parse szóközökkel', () => expect(parseAmount('1 250 000 Ft')).toBe(1250000));
  it('összeg-parse pontozott ezres tagolással', () => expect(parseAmount('1.250.000')).toBe(1250000));
  it('összeg-parse vesszős ezres tagolással', () => expect(parseAmount('1,250,000')).toBe(1250000));
  it('összeg-parse rövid ezres tagolással', () => expect(parseAmount('1.250')).toBe(1250));
  it('összeg-parse tizedesvesszővel', () => expect(parseAmount('27,5')).toBe(27.5));
  it('összeg-parse tizedesponttal', () => expect(parseAmount('27.5')).toBe(27.5));
  it('összeg-parse vegyes tagolás+tizedes', () => expect(parseAmount('1.250.000,50')).toBe(1250000.5));
  it('összeg-parse negatív', () => expect(parseAmount('-500')).toBe(-500));
  it('összeg-parse üres', () => expect(parseAmount('')).toBe(0));
});
