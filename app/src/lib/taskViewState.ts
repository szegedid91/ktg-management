// A kiválasztott sablon nézet (készülékenként) és a nézetek betöltése — a tiszta logika a taskViews.ts-ben van.

import { useMemo, useSyncExternalStore } from 'react';
import { store } from './store';
import { useTable } from './hooks';
import { getCurrentUserId } from './repo';
import { TaskViewPreset } from './types';
import { DEFAULT_VIEW_ID, TaskView, resolveViews } from './taskViews';

const KEY = 'taskview:active';
const EPOCH = '1970-01-01T00:00:00Z';
const listeners = new Set<() => void>();

export function getActiveTaskViewId(): string {
  const v = store.getCursor(KEY);
  return v === EPOCH ? DEFAULT_VIEW_ID : v;
}

export function setActiveTaskViewId(id: string): void {
  store.setCursor(KEY, id);
  listeners.forEach((l) => l());
}

/** A nézetek és a kiválasztott nézet (ha a kiválasztott már nem létezik, az Alap). */
export function useTaskViews(): { views: TaskView[]; active: TaskView } {
  const rows = useTable<TaskViewPreset>('task_view_presets');
  const activeId = useSyncExternalStore(
    (cb) => { listeners.add(cb); const un = store.subscribe(cb); return () => { listeners.delete(cb); un(); }; },
    getActiveTaskViewId, getActiveTaskViewId,
  );
  const userId = getCurrentUserId();
  const views = useMemo(() => resolveViews(rows, userId), [rows, userId]);
  const active = views.find((v) => v.id === activeId) ?? views[0];
  return { views, active };
}
