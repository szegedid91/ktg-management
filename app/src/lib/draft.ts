// Űrlap-piszkozat: a félbehagyott kitöltést 10 percig megőrizzük (kilépés,
// frissítés, másik oldal után visszatöltjük), mentés vagy ürítés törli.
// Weben localStorage, natívon AsyncStorage; az `omit` mezők (pl. bankszámla)
// soha nem kerülnek tárolásra.

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TTL_MS = 10 * 60 * 1000;

async function readRaw(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return await AsyncStorage.getItem(key);
  } catch { return null; }
}
async function writeRaw(key: string, value: string | null) {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
      return;
    }
    if (value === null) await AsyncStorage.removeItem(key); else await AsyncStorage.setItem(key, value);
  } catch { /* tárolás nélkül is működik */ }
}

export function useDraft<T extends object>(key: string, initial: () => T, omit: (keyof T)[] = []) {
  const storageKey = `draft:${key}`;
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const skipSave = useRef(true);

  // betöltés
  useEffect(() => {
    let alive = true;
    void readRaw(storageKey).then((raw) => {
      if (!alive) return;
      if (raw) {
        try {
          const { t, v } = JSON.parse(raw) as { t: number; v: Partial<T> };
          if (Date.now() - t < TTL_MS && v && typeof v === 'object') setValue({ ...initial(), ...v });
          else void writeRaw(storageKey, null);
        } catch { void writeRaw(storageKey, null); }
      }
      setReady(true);
    });
    return () => { alive = false; };
  }, [storageKey]);

  // mentés minden változásnál (a betöltés utáni első rendert kihagyjuk)
  useEffect(() => {
    if (!ready) return;
    if (skipSave.current) { skipSave.current = false; return; }
    const v: Partial<T> = { ...value };
    for (const k of omit) delete v[k];
    if (JSON.stringify(value) === JSON.stringify(initial())) { void writeRaw(storageKey, null); return; }
    void writeRaw(storageKey, JSON.stringify({ t: Date.now(), v }));
  }, [value, ready]);

  const clear = () => {
    setValue(initial());
    void writeRaw(storageKey, null);
  };
  const base = JSON.stringify(initial());
  const dirty = JSON.stringify(value) !== base;
  return { value, setValue, clear, dirty, ready };
}
