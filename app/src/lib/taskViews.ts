// Sablon nézetek a feladat oldalához (vezetőknek): a kiválasztott nézet mondja meg, hogy a feladat
// megnyitásakor melyik szakasz legyen nyitva, csukva vagy elrejtve. Két beépített sablon van (Alap,
// Elszámoláshoz) — ezek átállíthatók, a felhasználó változata a task_view_presets táblában él —, és
// tetszőleges számú egyedi sablon készíthető. A sablonok a fiókhoz tartoznak (minden készüléken ugyanazok);
// az, hogy épp melyik van kiválasztva, készülékenként tárolódik (lásd taskViewState.ts).

import { TaskViewPreset } from './types';

/** a feladat oldal állítható szakaszai (a megjelenés sorrendjében) */
export const VIEW_SECTIONS = [
  { key: 'site', label: '📍 Helyszín és kontakt' },
  // a műveletsáv nem összecsukható: vagy látszik, vagy nem
  { key: 'actions', label: '⚡ Műveletsáv (lezárás, munkaidő, anyag, fotó)', toggleOnly: true },
  { key: 'timeline', label: '🧭 Folyamat' },
  { key: 'time', label: '⏱ Munkaidő' },
  { key: 'materials', label: '📦 Anyagköltség és munkafotók' },
  { key: 'notes', label: '📝 Megjegyzések' },
  { key: 'quotes', label: '💬 Ajánlatok' },
  { key: 'finance', label: '💰 Pénzügy' },
  { key: 'more', label: '⋯ További műveletek' },
] as const;

export type ViewSectionKey = typeof VIEW_SECTIONS[number]['key'];
/** auto: az app dönt (pl. a megjegyzések nyitva, ha van megjegyzés) */
export type ViewMode = 'auto' | 'open' | 'closed' | 'hidden';
export type ViewSections = Partial<Record<ViewSectionKey, ViewMode>>;

export const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'open', label: 'Nyitva' },
  { value: 'closed', label: 'Csukva' },
  { value: 'hidden', label: 'Rejtve' },
];
/** a csak ki-be kapcsolható szakaszok (pl. műveletsáv) választói */
export const VIEW_TOGGLE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'auto', label: 'Látszik' },
  { value: 'hidden', label: 'Rejtve' },
];

const BUILTINS: { key: string; name: string; sections: ViewSections; editable: boolean }[] = [
  { key: 'default', name: 'Alap', sections: {}, editable: true },
  {
    // elszámoláshoz csak megnézni kell: nincs szerkesztés, nincs műveletsáv
    key: 'settlement', name: 'Elszámoláshoz', editable: false,
    sections: { site: 'closed', actions: 'hidden', timeline: 'open', time: 'open', materials: 'open', notes: 'open', quotes: 'open', finance: 'closed', more: 'closed' },
  },
];

export const DEFAULT_VIEW_ID = 'builtin:default';

export interface TaskView {
  /** beépítettnél „builtin:<kulcs>”, egyedinél a sor azonosítója */
  id: string;
  name: string;
  builtin: string | null;
  /** a tárolt sor (egyedi sablon, vagy a beépített átállított változata) */
  rowId: string | null;
  sections: ViewSections;
  /** hamis: ezzel a nézettel a feladat oldala csak megtekinthető */
  editable: boolean;
}

const KEYS = new Set<string>(VIEW_SECTIONS.map((s) => s.key));
const TOGGLE_ONLY = new Set<string>(VIEW_SECTIONS.filter((s) => 'toggleOnly' in s && s.toggleOnly).map((s) => s.key));
const MODES = new Set<string>(['auto', 'open', 'closed', 'hidden']);

/** csak az ismert szakaszok és állapotok maradnak (a tárolt adat bármi lehet); az „auto” nem tárolódik */
export function sanitizeSections(raw: unknown): ViewSections {
  const out: ViewSections = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEYS.has(k) || typeof v !== 'string' || !MODES.has(v) || v === 'auto') continue;
    if (TOGGLE_ONLY.has(k) && v !== 'hidden') continue; // csak látszik / rejtve
    out[k as ViewSectionKey] = v as ViewMode;
  }
  return out;
}

/** A felhasználó nézetei: a beépítettek (a saját átállításával, ha van), utánuk az egyediek. */
export function resolveViews(rows: TaskViewPreset[], userId: string | null): TaskView[] {
  const mine = rows.filter((r) => !r.deleted_at && (!userId || r.created_by === userId));
  const views: TaskView[] = BUILTINS.map((b) => {
    // több készülékről is keletkezhetett átállítás: a legfrissebb érvényes
    const ov = mine.filter((r) => r.builtin === b.key).sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)))[0];
    return { id: `builtin:${b.key}`, name: b.name, builtin: b.key, rowId: ov?.id ?? null, sections: ov ? sanitizeSections(ov.sections) : b.sections, editable: ov ? ov.editable !== false : b.editable };
  });
  const known = new Set(BUILTINS.map((b) => b.key));
  const custom = mine.filter((r) => !r.builtin || !known.has(r.builtin))
    .sort((x, y) => (x.position ?? 0) - (y.position ?? 0) || String(x.created_at).localeCompare(String(y.created_at)));
  for (const r of custom) views.push({ id: r.id, name: r.name, builtin: null, rowId: r.id, sections: sanitizeSections(r.sections), editable: r.editable !== false });
  return views;
}

/** a beépített sablon gyári beállítása (visszaállításhoz, összehasonlításhoz) */
export function builtinSections(key: string): ViewSections {
  return BUILTINS.find((b) => b.key === key)?.sections ?? {};
}
export function builtinEditable(key: string): boolean {
  return BUILTINS.find((b) => b.key === key)?.editable ?? true;
}

/** Egy szakasz állapota a nézet szerint. autoOpen: mit tenne az app sablon nélkül. */
export function sectionState(view: TaskView | null, key: ViewSectionKey, autoOpen: boolean): { hidden: boolean; open: boolean; viewKey: string } {
  const mode: ViewMode = view?.sections[key] ?? 'auto';
  return { hidden: mode === 'hidden', open: mode === 'auto' ? autoOpen : mode === 'open', viewKey: `${view?.id ?? ''}:${mode}` };
}
