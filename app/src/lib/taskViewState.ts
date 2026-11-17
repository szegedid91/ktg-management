// A kiválasztott (utoljára használt) sablon nézet (készülékenként, fiókonként — lásd prefs.ts) és a nézetek betöltése — a tiszta logika a taskViews.ts-ben van.

import { useMemo } from 'react';
import { store } from './store';
import { useTable } from './hooks';
import { getCurrentUserId } from './repo';
import { getPref, setPref, usePref } from './prefs';
import { TaskViewPreset } from './types';
import { DEFAULT_VIEW_ID, TaskView, resolveViews } from './taskViews';

const KEY = 'taskview:active';
const EPOCH = '1970-01-01T00:00:00Z';

/** Az utoljára használt nézet — a készüléken, fiókonként megjegyezve (kijelentkezés után is megmarad). */
export function getActiveTaskViewId(): string {
  const v = getPref(KEY);
  if (v) return v;
  // átállás: a korábbi verzió a tár kurzorai közt tartotta (az kijelentkezéskor törlődött)
  const legacy = store.getCursor(KEY);
  return legacy === EPOCH ? DEFAULT_VIEW_ID : legacy;
}

export function setActiveTaskViewId(id: string): void {
  setPref(KEY, id);
}

/** A nézetek és a kiválasztott nézet (ha a kiválasztott már nem létezik, az Alap). */
export function useTaskViews(): { views: TaskView[]; active: TaskView } {
  const rows = useTable<TaskViewPreset>('task_view_presets');
  usePref(KEY); // a kiválasztás változásakor újrarajzol
  const activeId = getActiveTaskViewId();
  const userId = getCurrentUserId();
  const views = useMemo(() => resolveViews(rows, userId), [rows, userId]);
  const active = views.find((v) => v.id === activeId) ?? views[0];
  return { views, active };
}
