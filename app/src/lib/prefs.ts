// Felhasználói megjelenítési beállítások ezen a készüléken (pl. az utoljára használt nézet).
// Fiókonként külön kulcson, és SZÁNDÉKOSAN nem a tár „ktg:” előtagján: a kijelentkezés (store.clearAll)
// nem törli, így újra belépve, frissítés vagy app-újraindítás után is ugyanaz marad.

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from './store';
import { getCurrentUserId } from './repo';

const PREFIX = 'pref:';
/** teljes kulcs → érték (null = betöltve, nincs érték) */
const mem = new Map<string, string | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const fullKey = (key: string) => `${PREFIX}${getCurrentUserId() ?? 'anon'}:${key}`;

/** Az érték, ha már be van töltve; különben null, és a háttérben betöltjük (utána a figyelők értesülnek). */
export function getPref(key: string): string | null {
  const k = fullKey(key);
  if (mem.has(k)) return mem.get(k) ?? null;
  if (!loading.has(k)) {
    loading.add(k);
    AsyncStorage.getItem(k)
      .then((v) => { if (!mem.has(k)) { mem.set(k, v); emit(); } })
      .catch(() => { if (!mem.has(k)) mem.set(k, null); })
      .finally(() => loading.delete(k));
  }
  return null;
}

export function setPref(key: string, value: string): void {
  const k = fullKey(key);
  mem.set(k, value);
  emit();
  AsyncStorage.setItem(k, value).catch(() => { /* tárolás nélkül is működik, csak nem jegyződik meg */ });
}

/** Beállítás figyelése: változáskor (és fiókváltáskor) újrarajzol. */
export function usePref(key: string): string | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); const un = store.subscribe(cb); return () => { listeners.delete(cb); un(); }; },
    () => getPref(key), () => getPref(key),
  );
}
