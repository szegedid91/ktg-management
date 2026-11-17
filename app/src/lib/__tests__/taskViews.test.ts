import { describe, it, expect } from 'vitest';
import { resolveViews, sectionState, sanitizeSections, builtinSections, DEFAULT_VIEW_ID } from '../taskViews';
import { TaskViewPreset } from '../types';

const row = (p: Partial<TaskViewPreset>): TaskViewPreset => ({
  id: 'r1', name: 'x', builtin: null, sections: {}, position: 0, created_by: 'u1',
  created_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-17T10:00:00Z', deleted_at: null, ...p,
});

describe('sablon nézetek', () => {
  it('sor nélkül a két beépített sablon van, az Alap minden szakasza automatikus', () => {
    const v = resolveViews([], 'u1');
    expect(v.map((x) => x.name)).toEqual(['Alap', 'Elszámoláshoz']);
    expect(v[0].id).toBe(DEFAULT_VIEW_ID);
    expect(v[0].sections).toEqual({});
    expect(v[1].sections.site).toBe('closed');
    expect(v[1].sections.finance).toBe('closed');
    expect(v[1].sections.time).toBe('open');
    // az Elszámoláshoz gyárilag csak megtekintés: nincs szerkesztés, nincs műveletsáv
    expect(v[0].editable).toBe(true);
    expect(v[1].editable).toBe(false);
    expect(v[1].sections.actions).toBe('hidden');
  });

  it('szerkesztési lehetőség: a tárolt sor értéke érvényes; hiányzó érték = van szerkesztés', () => {
    const v = resolveViews([
      row({ id: 'ov', builtin: 'settlement', sections: { site: 'closed' }, editable: true }),
      row({ id: 'c1', name: 'Csak nézem', editable: false, position: 1 }),
      row({ id: 'c2', name: 'Régi sor', position: 2 }),
    ], 'u1');
    expect(v[1].editable).toBe(true);
    expect(v[2].editable).toBe(false);
    expect(v[3].editable).toBe(true);
  });

  it('a műveletsáv csak látszik / rejtve lehet', () => {
    expect(sanitizeSections({ actions: 'closed' })).toEqual({});
    expect(sanitizeSections({ actions: 'open' })).toEqual({});
    expect(sanitizeSections({ actions: 'hidden' })).toEqual({ actions: 'hidden' });
  });

  it('a beépített sablon átállítása felülírja a gyári beállítást; a legfrissebb érvényes', () => {
    const v = resolveViews([
      row({ id: 'a', builtin: 'settlement', sections: { site: 'hidden' }, updated_at: '2026-11-17T10:00:00Z' }),
      row({ id: 'b', builtin: 'settlement', sections: { site: 'open', finance: 'hidden' }, updated_at: '2026-11-17T11:00:00Z' }),
    ], 'u1');
    expect(v).toHaveLength(2);
    expect(v[1].rowId).toBe('b');
    expect(v[1].sections).toEqual({ site: 'open', finance: 'hidden' });
  });

  it('törölt és más felhasználóhoz tartozó sor nem számít; az egyediek sorrendben a beépítettek után', () => {
    const v = resolveViews([
      row({ id: 'c2', name: 'Második', position: 2 }),
      row({ id: 'c1', name: 'Első', position: 1, sections: { more: 'hidden' } }),
      row({ id: 'del', name: 'Törölt', deleted_at: '2026-11-17T12:00:00Z' }),
      row({ id: 'other', name: 'Másé', created_by: 'u2' }),
      row({ id: 'ov', builtin: 'settlement', sections: { site: 'open' }, deleted_at: '2026-11-17T12:00:00Z' }),
    ], 'u1');
    expect(v.map((x) => x.name)).toEqual(['Alap', 'Elszámoláshoz', 'Első', 'Második']);
    expect(v[1].sections).toEqual(builtinSections('settlement'));
    expect(v[2].sections).toEqual({ more: 'hidden' });
  });

  it('ismeretlen szakasz / állapot kiszűrődik, az auto nem tárolódik', () => {
    expect(sanitizeSections({ site: 'closed', valami: 'open', time: 'félig', notes: 'auto', more: 5 })).toEqual({ site: 'closed' });
    expect(sanitizeSections(null)).toEqual({});
    expect(sanitizeSections(['open'])).toEqual({});
  });

  it('szakasz állapota: auto = az app döntése, különben a sablon', () => {
    const [alap, elsz] = resolveViews([], 'u1');
    expect(sectionState(alap, 'notes', true)).toMatchObject({ hidden: false, open: true });
    expect(sectionState(alap, 'notes', false)).toMatchObject({ hidden: false, open: false });
    expect(sectionState(elsz, 'finance', true)).toMatchObject({ hidden: false, open: false });
    expect(sectionState(elsz, 'time', false)).toMatchObject({ hidden: false, open: true });
    const rejt = resolveViews([row({ id: 'h', name: 'Rejt', sections: { more: 'hidden' } })], 'u1')[2];
    expect(sectionState(rejt, 'more', false).hidden).toBe(true);
    // nézet nélkül (munkavállaló): mindig az app döntése
    expect(sectionState(null, 'finance', true)).toMatchObject({ hidden: false, open: true });
    // a jel nézetenként / állapotonként más — ebből áll vissza a szakasz nézetváltáskor
    expect(sectionState(alap, 'site', true).viewKey).not.toBe(sectionState(elsz, 'site', true).viewKey);
  });
});
