// Anyagköltség mennyiségi egységei: beépített alaplista + a felhasználó saját egységei (material_units —
// a sajátjai, és ha egy vállalkozó embere, a főnökéi is; ezt a szerver szűri).

import { MaterialUnit } from './types';

export const DEFAULT_UNITS = ['db', 'méter', 'm²', 'm³', 'kg', 'liter', 'zsák', 'csomag', 'doboz', 'tekercs', 'szál', 'tábla', 'pár', 'készlet'];

export const UNIT_MAX = 20;
const norm = (s: string) => s.trim().toLowerCase();

/** új egység neve: szóközök rendezve, legfeljebb UNIT_MAX karakter */
export function cleanUnit(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, UNIT_MAX);
}

export interface UnitOption { name: string; rowId: string | null; own: boolean }

/** A választható egységek: az alaplista, utána a saját (és a főnöktől látott) egységek ábécében — ismétlés
 *  nélkül (kis- / nagybetű nem számít). `current`: a tételen már szereplő érték akkor is választható marad,
 *  ha nincs a listában (pl. régebben szabadon beírt egység). */
export function unitOptions(rows: MaterialUnit[], userId: string | null, current?: string | null): UnitOption[] {
  const seen = new Set<string>();
  const out: UnitOption[] = [];
  const push = (name: string, rowId: string | null, own: boolean) => {
    const k = norm(name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ name: name.trim(), rowId, own });
  };
  for (const u of DEFAULT_UNITS) push(u, null, false);
  const custom = rows.filter((r) => !r.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  // előbb a sajátok (ezek törölhetők), utána a főnöktől látottak
  for (const r of custom.filter((x) => x.created_by === userId)) push(r.name, r.id, true);
  for (const r of custom.filter((x) => x.created_by !== userId)) push(r.name, r.id, false);
  if (current) push(current, null, false);
  return out;
}

/** van-e már ilyen egység a listában (kis- / nagybetűtől függetlenül) — a meglévő nevét adja vissza */
export function findUnit(options: UnitOption[], name: string): string | null {
  const k = norm(name);
  return options.find((o) => norm(o.name) === k)?.name ?? null;
}
