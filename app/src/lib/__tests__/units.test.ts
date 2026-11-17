import { describe, it, expect } from 'vitest';
import { unitOptions, findUnit, cleanUnit, DEFAULT_UNITS } from '../units';
import { MaterialUnit } from '../types';

const row = (p: Partial<MaterialUnit>): MaterialUnit => ({
  id: 'r', name: 'x', created_by: 'me', created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-17T10:00:00Z', deleted_at: null, ...p,
});

describe('mennyiségi egységek', () => {
  it('saját egység nélkül az alaplista', () => {
    expect(unitOptions([], 'me').map((o) => o.name)).toEqual(DEFAULT_UNITS);
  });

  it('a saját egységek az alaplista után, ábécében; a főnöktől látott nem törölhető; a törölt kimarad', () => {
    const o = unitOptions([
      row({ id: 'a', name: 'vödör' }),
      row({ id: 'b', name: 'raklap' }),
      row({ id: 'c', name: 'konténer', created_by: 'boss' }),
      row({ id: 'd', name: 'régi', deleted_at: '2026-11-17T12:00:00Z' }),
    ], 'me');
    expect(o.slice(DEFAULT_UNITS.length).map((x) => [x.name, x.own])).toEqual([['raklap', true], ['vödör', true], ['konténer', false]]);
    expect(o.find((x) => x.name === 'raklap')?.rowId).toBe('b');
  });

  it('nincs ismétlés: az alaplistában lévő vagy kis-/nagybetűben eltérő egység egyszer szerepel', () => {
    const o = unitOptions([row({ id: 'a', name: 'DB' }), row({ id: 'b', name: 'Vödör' }), row({ id: 'c', name: 'vödör', created_by: 'boss' })], 'me');
    expect(o.filter((x) => x.name.toLowerCase() === 'db')).toHaveLength(1);
    expect(o.filter((x) => x.name.toLowerCase() === 'vödör')).toHaveLength(1);
  });

  it('a tételen szereplő, listán kívüli érték választható marad', () => {
    expect(unitOptions([], 'me', 'fm').map((o) => o.name)).toContain('fm');
    expect(unitOptions([], 'me', 'db').filter((o) => o.name === 'db')).toHaveLength(1);
  });

  it('keresés kis-/nagybetűtől függetlenül; a név tisztítása', () => {
    const o = unitOptions([row({ name: 'Vödör' })], 'me');
    expect(findUnit(o, ' vödör ')).toBe('Vödör');
    expect(findUnit(o, 'hordó')).toBeNull();
    expect(cleanUnit('  nagy   zsák  ')).toBe('nagy zsák');
    expect(cleanUnit('x'.repeat(40))).toHaveLength(20);
  });
});
